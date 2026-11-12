"""Programa das câmeras da loja. Uso: python principal.py [--config config.json] [--mostrar]"""
import argparse
import logging
import time

import cv2

from pili_visao import config as cfgmod
from pili_visao.armazenamento import Armazenamento
from pili_visao.camera import FonteVideo
from pili_visao.loja import ClienteLoja, Emissor
from pili_visao.planta import Planta
from pili_visao.porta import BarreiraSimulada, MonitorPorta, SireneSimulada
from pili_visao.prateleira import criar_detector
from pili_visao.processador import ProcessadorCamera
from pili_visao.rastreio import criar_rastreador
from pili_visao.trajetos import Trajetos
from pili_visao.visitas import VinculoVisitas

log = logging.getLogger("visao")


def _desenhar(proc: ProcessadorCamera, quadro):
    alt, larg = quadro.shape[:2]
    for z in proc.zonas:
        proc._contorno(z, quadro)
    if proc.cam.get("zonaPorta"):
        from pili_visao.zonas import pontos_px
        cv2.polylines(quadro, [pontos_px(proc.cam["zonaPorta"], larg, alt)], True, (255, 128, 0), 2)
    for r in proc.rastros:
        x1, y1, x2, y2 = (int(v) for v in r.caixa)
        chave = (proc.nome, r.id)
        rotulo = "INTRUSO" if proc.vinculo.eh_intruso(chave) else (proc.vinculo.visita_de(chave) or "?")
        cv2.rectangle(quadro, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(quadro, f"{r.id} {rotulo[-8:]}", (x1, max(15, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
    return quadro


def _epoca(iso):
    from datetime import datetime
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def atender_pedidos(cliente, trajetos) -> int:
    """A loja achou item faltando: monta o trajeto de cada pessoa pedida e devolve."""
    feitos = 0
    for pedido in cliente.pedidos_trajeto():
        inicio, fim = _epoca(pedido.get("inicio")), _epoca(pedido.get("fim"))
        r = trajetos.compilar(pedido["visitaId"], pedido.get("nome") or "cliente",
                              inicio - 5 if inicio else None, fim + 30 if fim else None,
                              rotulo="divergencia_" + str(pedido["divergenciaId"]))
        if cliente.enviar_trajeto({"divergenciaId": pedido["divergenciaId"], "visitaId": pedido["visitaId"], **r}):
            log.info("trajeto de %s enviado (%d imagem(ns))", pedido.get("nome"), len(r["imagens"]))
            feitos += 1
    return feitos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=None)
    ap.add_argument("--mostrar", action="store_true", help="abre uma janela por câmera (Q fecha)")
    ap.add_argument("--max-quadros", type=int, default=0, help="para depois de N quadros (teste)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    cfg = cfgmod.carregar(args.config)
    if not cfg["cameras"]:
        raise SystemExit("Nenhuma câmera no config.json.")
    token = cfgmod.token_loja(cfg)
    if not token:
        log.warning("Sem token da loja (loja/dados/token-local.txt ou LOJA_TOKEN_LOCAL): a loja pode recusar as chamadas.")
    cliente = ClienteLoja(cfg["loja"]["url"], token)
    arm = Armazenamento(cfgmod.pasta_dados(cfg), cfg["dados"]["diasGuardar"])
    emissor = Emissor(cliente.enviar_evento, arm.fila)
    vinculo = VinculoVisitas(cliente.visitas_ativas, cfg["loja"]["intervaloVisitasSegundos"])
    porta = MonitorPorta(SireneSimulada(), BarreiraSimulada(), cfg["porta"]["sireneSegundos"], cfg["porta"]["exigirBarreira"])
    planta = Planta(cfg)
    trajetos = Trajetos(cfgmod.pasta_dados(cfg), planta, cfg["trajeto"], cfg["dados"]["diasGuardar"])
    sem_chao = [c["nome"] for c in cfg["cameras"] if not planta.calibrada(c["nome"])]
    if sem_chao and len(cfg["cameras"]) > 1:
        log.warning("câmeras sem o chão calibrado (%s): não seguem a pessoa vinda de outra câmera. Rode calibrar_chao.py.", ", ".join(sem_chao))

    p = cfg["pessoas"]
    cameras = []
    for cam in cfg["cameras"]:
        rastreador = criar_rastreador(p, cfgmod.RAIZ)
        detector = criar_detector(cfg["prateleira"], rastreador.dispositivo)
        cameras.append((FonteVideo(cam["fonte"]), ProcessadorCamera(cfg, cam, rastreador, detector, vinculo, emissor, arm, porta,
                                                                           planta=planta, trajetos=trajetos)))
        log.info("câmera %s: fonte %s, %d zona(s)", cam["nome"], cam["fonte"], len(cam.get("zonas", [])))

    periodo = 1.0 / max(1, p["fpsAlvo"])
    quadros, inicio, ultimo_descarrego = 0, time.time(), 0.0
    try:
        while True:
            t0 = time.time()
            for fonte, proc in cameras:
                quadro = fonte.ler()
                if quadro is None and not fonte.ao_vivo:
                    raise KeyboardInterrupt  # arquivo de vídeo acabou
                proc.processar(quadro, time.time())
                if quadro is not None:
                    quadros += 1
                    if args.mostrar:
                        cv2.imshow(proc.nome, _desenhar(proc, quadro.copy()))
            if args.mostrar and cv2.waitKey(1) & 0xFF == ord("q"):
                break
            if time.time() - ultimo_descarrego > 10:
                ultimo_descarrego = time.time()
                if vinculo.loja_respondendo(time.time()):   # loja fora do ar: não gasta o tempo limite de cada chamada
                    emissor.descarregar()
                    atender_pedidos(cliente, trajetos)
                planta.limpar(time.time(), {v["visitaId"] for v in vinculo.ativas})
            if args.max_quadros and quadros >= args.max_quadros:
                break
            if quadros and quadros % 100 == 0:
                log.info("%.1f quadros/s", quadros / (time.time() - inicio))
            time.sleep(max(0.0, periodo - (time.time() - t0)))
    except KeyboardInterrupt:
        pass
    finally:
        for fonte, _ in cameras:
            fonte.fechar()
        cv2.destroyAllWindows()
        if quadros:
            log.info("fim: %d quadros, %.1f quadros/s", quadros, quadros / max(0.001, time.time() - inicio))


if __name__ == "__main__":
    main()
