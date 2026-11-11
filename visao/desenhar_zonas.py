"""Desenha as zonas de uma câmera sobre um quadro dela e grava no config.json.

Uso: python desenhar_zonas.py --camera cam1 [--fonte 0] [--config config.json]

Clique os cantos da zona. Teclas:
  N  fecha o polígono como zona de PRATELEIRA (o nome é pedido no terminal)
  P  fecha o polígono como zona da PORTA
  Z  desfaz o último ponto          X  apaga a última zona de prateleira
  R  grava o quadro de referência (enquadramento certo, loja vazia)
  V  grava a foto da prateleira VAZIA (melhora o "saiu/voltou")
  A  atualiza o quadro              S  salva o config      Q  sai
"""
import argparse

import cv2

from pili_visao import config as cfgmod
from pili_visao.armazenamento import Armazenamento
from pili_visao.camera import FonteVideo
from pili_visao.zonas import pontos_px

JANELA = "Zonas (N prateleira, P porta, Z desfaz, S salva, Q sai)"


def _quadro(fonte: FonteVideo):
    import time

    for _ in range(100):
        q = fonte.ler()
        if q is not None:
            return q
        time.sleep(0.1)
    raise SystemExit("Não consegui ler um quadro dessa fonte.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", required=True)
    ap.add_argument("--fonte", default=None)
    ap.add_argument("--config", default=None)
    args = ap.parse_args()

    cfg = cfgmod.carregar(args.config)
    cam = next((c for c in cfg["cameras"] if c["nome"] == args.camera), None)
    if cam is None:
        if args.fonte is None:
            raise SystemExit("Câmera nova: informe --fonte (RTSP, número da webcam ou arquivo).")
        cam = {"nome": args.camera, "fonte": args.fonte, "zonaPorta": None, "zonas": []}
        cfg["cameras"].append(cam)
    elif args.fonte is not None:
        cam["fonte"] = args.fonte
    if isinstance(cam["fonte"], str) and cam["fonte"].isdigit():
        cam["fonte"] = int(cam["fonte"])
    cam.setdefault("zonas", [])

    arm = Armazenamento(cfgmod.pasta_dados(cfg), cfg["dados"]["diasGuardar"])
    fonte = FonteVideo(cam["fonte"])
    quadro = _quadro(fonte)
    alt, larg = quadro.shape[:2]
    pontos: list[list[float]] = []

    def clique(evento, x, y, *_):
        if evento == cv2.EVENT_LBUTTONDOWN:
            pontos.append([round(x / larg, 4), round(y / alt, 4)])

    cv2.namedWindow(JANELA, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(JANELA, clique)
    while True:
        tela = quadro.copy()
        for z in cam["zonas"]:
            pts = pontos_px(z["poligono"], larg, alt)
            cv2.polylines(tela, [pts], True, (0, 255, 255), 2)
            cv2.putText(tela, z["nome"], tuple(int(v) for v in pts[0]), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
        if cam.get("zonaPorta"):
            pts = pontos_px(cam["zonaPorta"], larg, alt)
            cv2.polylines(tela, [pts], True, (255, 128, 0), 2)
            cv2.putText(tela, "PORTA", tuple(int(v) for v in pts[0]), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 128, 0), 2)
        if pontos:
            pts = pontos_px(pontos, larg, alt)
            cv2.polylines(tela, [pts], False, (0, 0, 255), 2)
            for p in pts:
                cv2.circle(tela, tuple(int(v) for v in p), 4, (0, 0, 255), -1)
        cv2.imshow(JANELA, tela)
        tecla = cv2.waitKey(30) & 0xFF
        if tecla == ord("q"):
            break
        if tecla == ord("z") and pontos:
            pontos.pop()
        elif tecla == ord("x") and cam["zonas"]:
            print("apagada:", cam["zonas"].pop()["nome"])
        elif tecla == ord("a"):
            quadro = _quadro(fonte)
        elif tecla == ord("n") and len(pontos) >= 3:
            nome = input("Nome da zona de prateleira (ex.: A1): ").strip() or f"zona{len(cam['zonas']) + 1}"
            cam["zonas"] = [z for z in cam["zonas"] if z["nome"] != nome] + [{"nome": nome, "poligono": pontos[:]}]
            pontos.clear()
        elif tecla == ord("p") and len(pontos) >= 3:
            cam["zonaPorta"] = pontos[:]
            pontos.clear()
        elif tecla == ord("r"):
            cv2.imwrite(str(arm.referencias / f"{cam['nome']}.jpg"), quadro)
            print("quadro de referência gravado")
        elif tecla == ord("v"):
            cv2.imwrite(str(arm.referencias / f"{cam['nome']}_vazia.jpg"), quadro)
            print("foto da prateleira vazia gravada")
        elif tecla == ord("s"):
            cfgmod.salvar(cfg, args.config)
            print("config salvo")
    fonte.fechar()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
