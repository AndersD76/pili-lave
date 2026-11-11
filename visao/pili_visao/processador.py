"""O que acontece a cada quadro de uma câmera: pessoas, porta e prateleiras."""
import logging
from collections import deque
from dataclasses import dataclass, field

import cv2
import numpy as np

from . import zonas
from .armazenamento import Armazenamento, codificar, decodificar
from .camera import VigiaCamera
from .loja import Emissor, novo_evento
from .porta import MonitorPorta
from .prateleira import DetectorPrateleira, Medida
from .visitas import VinculoVisitas

log = logging.getLogger("visao.processador")

MIN_QUADROS = 2          # quadros seguidos para um rastro novo valer
SEGUNDOS_PERDIDO = 1.0   # sem aparecer por isso, o rastro é dado como perdido
SEGUNDOS_HERANCA = 10.0  # um rastro novo perto de um perdido herda a visita dele
LIMIAR_ESTAVEL = 3.0     # diferença média entre quadros para a zona estar "parada"


@dataclass
class _Zona:
    nome: str
    poligono: list
    masc: np.ndarray
    presenca: np.ndarray
    ret: tuple
    area_item: float | None
    vazia: np.ndarray | None = None
    ref: Medida | None = None
    ref_jpeg: bytes = b""
    anterior: np.ndarray | None = None
    estaveis: int = 0
    visitas: set = field(default_factory=set)
    sem_visita: set = field(default_factory=set)
    durante_jpeg: bytes = b""
    ultima_medida: float = -1e18

    def recorte(self, imagem):
        x, y, w, h = self.ret
        return imagem[y:y + h, x:x + w]


class ProcessadorCamera:
    def __init__(self, cfg: dict, cfg_camera: dict, rastreador, detector: DetectorPrateleira,
                 vinculo: VinculoVisitas, emissor: Emissor, armazenamento: Armazenamento,
                 porta: MonitorPorta, vigia: VigiaCamera | None = None):
        self.cfg = cfg
        self.cam = cfg_camera
        self.nome = cfg_camera["nome"]
        self.rastreador = rastreador
        self.detector = detector
        self.vinculo = vinculo
        self.emissor = emissor
        self.arm = armazenamento
        self.porta = porta
        self.vigia = vigia or VigiaCamera(
            self._ler_referencia(""),
            cfg["camera"]["segundosSemQuadro"],
            cfg["camera"]["intervaloAlinhamentoSegundos"],
            cfg["camera"]["desvioMaximo"],
        )
        self.formato = None
        self.zonas: list[_Zona] = []
        self.masc_porta = None
        self.vivos: dict[int, dict] = {}
        self.perdidos: list[tuple] = []
        self.pendentes: dict[int, float] = {}
        fps = max(1, int(cfg["pessoas"]["fpsAlvo"]))
        self.fps = fps
        self.buffer: deque = deque(maxlen=fps * 4)
        self.rastros: list = []

    # ---------- preparo ----------

    def _ler_referencia(self, sufixo: str):
        caminho = self.arm.referencias / f"{self.nome}{sufixo}.jpg"
        return cv2.imread(str(caminho)) if caminho.exists() else None

    def _preparar(self, quadro) -> None:
        alt, larg = quadro.shape[:2]
        if self.formato == (alt, larg):
            return
        self.formato = (alt, larg)
        margem = self.cfg["prateleira"]["margemPessoa"]
        vazia = self._ler_referencia("_vazia")
        if vazia is not None:
            vazia = cv2.GaussianBlur(cv2.cvtColor(cv2.resize(vazia, (larg, alt)), cv2.COLOR_BGR2GRAY), (5, 5), 0).astype(np.int16)
        self.zonas = []
        for z in self.cam.get("zonas", []):
            masc = zonas.mascara(z["poligono"], larg, alt)
            if not masc.any():
                continue
            zona = _Zona(z["nome"], z["poligono"], masc, zonas.mascara(z["poligono"], larg, alt, margem),
                         zonas.retangulo(masc), z.get("areaItem"))
            zona.masc = zona.recorte(masc)
            zona.vazia = zona.recorte(vazia) if vazia is not None else None
            self.zonas.append(zona)
        porta = self.cam.get("zonaPorta")
        self.masc_porta = zonas.mascara(porta, larg, alt) if porta else None

    # ---------- laço ----------

    def processar(self, quadro, agora: float) -> None:
        if quadro is None:
            self._aviso_camera(self.vigia.sem_quadro(agora), None, agora)
            return
        self._aviso_camera(self.vigia.com_quadro(agora), quadro, agora)
        self._preparar(quadro)
        self.rastros = self.rastreador.atualizar(quadro)
        self.vinculo.atualizar(agora)
        self._ciclo_de_vida(self.rastros, agora)
        self._porta(self.rastros, quadro, agora)
        if self.vigia.problema is None:
            self._prateleiras(self.rastros, quadro, agora)
        if not self.rastros:
            if self.vigia.ref is None:
                self.vigia.definir_referencia(quadro)
                cv2.imwrite(str(self.arm.referencias / f"{self.nome}.jpg"), quadro)
                log.warning("%s: sem quadro de referência — usando o atual. Confira o enquadramento.", self.nome)
            self._aviso_camera(self.vigia.conferir(quadro, agora), quadro, agora)
        pequeno = quadro if quadro.shape[1] <= 640 else cv2.resize(quadro, (640, round(quadro.shape[0] * 640 / quadro.shape[1])))
        self.buffer.append(codificar(pequeno, 60))
        self.arm.limpar()

    def _aviso_camera(self, aviso, quadro, agora) -> None:
        if not aviso:
            return
        imagens = [self.arm.salvar_jpeg(self.nome, aviso.lower(), quadro, agora)] if quadro is not None else []
        self.emissor.emitir(novo_evento("CAMERA", self.nome, agora, imagens=imagens, camera=self.nome, detalhe=aviso))

    # ---------- pessoas ----------

    def _norm(self, ponto):
        alt, larg = self.formato
        return ponto[0] / larg, ponto[1] / alt

    def _ciclo_de_vida(self, rastros, agora) -> None:
        for r in rastros:
            v = self.vivos.get(r.id)
            if v is None:
                v = self.vivos[r.id] = {"primeira": r.caixa, "quadros": 0, "confirmado": False}
            v["quadros"] += 1
            v["ultimo"] = agora
            v["centro"] = self._norm(zonas.centro(r.caixa))
            if not v["confirmado"] and v["quadros"] >= MIN_QUADROS:
                v["confirmado"] = True
                self._nasceu(r.id, v, agora)
        for id_, v in list(self.vivos.items()):
            if agora - v["ultimo"] > SEGUNDOS_PERDIDO:
                del self.vivos[id_]
                self.pendentes.pop(id_, None)
                if v["confirmado"]:
                    self.perdidos.append(((self.nome, id_), v["centro"], agora))
        for item in list(self.perdidos):
            if agora - item[2] > SEGUNDOS_HERANCA:
                self.perdidos.remove(item)
                self.vinculo.soltar(item[0])

    def _perdido_mais_perto(self, centro, alcance):
        melhor, menor = None, alcance
        for item in self.perdidos:
            d = float(np.hypot(centro[0] - item[1][0], centro[1] - item[1][1]))
            if d < menor and item[0] in self.vinculo.vinculos:
                melhor, menor = item, d
        return melhor

    def _herdar(self, chave, centro, alcance) -> bool:
        item = self._perdido_mais_perto(centro, alcance)
        if item is None:
            return False
        self.vinculo.herdar(chave, item[0])
        self.perdidos.remove(item)
        return True

    def _nasceu(self, id_, v, agora) -> None:
        chave = (self.nome, id_)
        if self._herdar(chave, v["centro"], 0.12):
            return
        x1, y1, x2, y2 = v["primeira"]
        na_porta = self.masc_porta is not None and (
            zonas.ponto_dentro(zonas.centro(v["primeira"]), self.masc_porta)
            or zonas.ponto_dentro(((x1 + x2) / 2, y2), self.masc_porta)
        )
        if na_porta:
            self.pendentes[id_] = agora
        elif not self._herdar(chave, v["centro"], 0.3):
            self.vinculo.vincular_unica(chave)

    def _porta(self, rastros, quadro, agora) -> None:
        por_id = {r.id: r for r in rastros}
        for id_, desde in list(self.pendentes.items()):
            chave = (self.nome, id_)
            if self.vinculo.vincular_entrada(chave, agora):
                del self.pendentes[id_]
            elif agora - desde >= self.cfg["porta"]["toleranciaSegundos"]:
                del self.pendentes[id_]
                if self.porta.confirma_invasao(agora):
                    self._invasao(chave, por_id.get(id_), quadro, agora)
        visivel = False
        for id_, v in self.vivos.items():
            if not v["confirmado"] or id_ not in por_id:
                continue
            chave = (self.nome, id_)
            if self.vinculo.eh_intruso(chave) or (
                self.porta.sirene.ligada and id_ not in self.pendentes and self.vinculo.visita_de(chave) is None
            ):
                visivel = True
        self.porta.atualizar(self.nome, visivel, agora)

    def _invasao(self, chave, rastro, quadro, agora) -> None:
        self.vinculo.marcar_intruso(chave)
        self.porta.invasao(agora)
        marcado = quadro.copy()
        if rastro is not None:
            x1, y1, x2, y2 = (int(v) for v in rastro.caixa)
            cv2.rectangle(marcado, (x1, y1), (x2, y2), (0, 0, 255), 3)
        imagem = self.arm.salvar_jpeg(self.nome, "invasao", marcado, agora)
        clipe = self.arm.salvar_clipe(self.nome, "invasao", list(self.buffer), self.fps, agora)
        self.emissor.emitir(novo_evento("PORTA", "porta", agora, delta=1, imagens=[imagem], camera=self.nome,
                                        detalhe="INVASAO", clipe=clipe))

    # ---------- prateleiras ----------

    def _prateleiras(self, rastros, quadro, agora) -> None:
        cfg = self.cfg["prateleira"]
        for z in self.zonas:
            ocupantes = [r for r in rastros if zonas.caixa_toca(r.caixa, z.presenca)]
            if ocupantes:
                for r in ocupantes:
                    visita = self.vinculo.visita_de((self.nome, r.id))
                    if visita:
                        z.visitas.add(visita)
                    else:
                        z.sem_visita.add(r.id)
                z.durante_jpeg = codificar(quadro)
                z.estaveis = 0
                z.anterior = None
                continue
            cinza = cv2.cvtColor(z.recorte(quadro), cv2.COLOR_BGR2GRAY)
            if z.anterior is not None and float(cv2.absdiff(cinza, z.anterior).mean()) < LIMIAR_ESTAVEL:
                z.estaveis += 1
            else:
                z.estaveis = 0
            z.anterior = cinza
            if z.estaveis < cfg["quadrosEstaveis"]:
                continue
            houve_gente = bool(z.visitas or z.sem_visita)
            if z.ref is not None and not houve_gente and agora - z.ultima_medida < cfg["reconferirSegundos"]:
                continue
            z.ultima_medida = agora
            z.estaveis = 0
            atual = self.detector.medir(z.recorte(quadro), z.masc)
            if z.ref is not None:
                delta = self.detector.comparar(z.ref, atual, z.masc, z.vazia, z.area_item)
                if delta != 0:
                    if self.vigia.ref is not None and self.vigia.desvio(quadro) > self.vigia.desvio_maximo:
                        log.warning("%s/%s: mudança ignorada, câmera parece ter saído do lugar", self.nome, z.nome)
                        self._aviso_camera(self.vigia.conferir(quadro, agora, forcar=True), quadro, agora)
                        continue
                    self._evento_prateleira(z, delta, quadro, agora)
            z.ref = atual
            z.ref_jpeg = codificar(quadro)
            z.visitas.clear()
            z.sem_visita.clear()
            z.durante_jpeg = b""

    def _contorno(self, z: _Zona, imagem):
        alt, larg = imagem.shape[:2]
        cv2.polylines(imagem, [zonas.pontos_px(z.poligono, larg, alt)], True, (0, 255, 255), 2)
        return imagem

    def _evento_prateleira(self, z: _Zona, delta, quadro, agora) -> None:
        imagens = [self.arm.salvar_jpeg(self.nome, f"{z.nome}_antes", self._contorno(z, decodificar(z.ref_jpeg)), agora)]
        if z.durante_jpeg:
            imagens.append(self.arm.salvar_jpeg(self.nome, f"{z.nome}_durante", z.durante_jpeg, agora))
        imagens.append(self.arm.salvar_jpeg(self.nome, f"{z.nome}_depois", self._contorno(z, quadro.copy()), agora))
        self.emissor.emitir(novo_evento(
            "PRATELEIRA", z.nome, agora, delta=delta, visitas=sorted(z.visitas), imagens=imagens,
            camera=self.nome, rastrosSemVisita=len(z.sem_visita),
            ambiguo=bool(z.visitas and z.sem_visita),
            estimado=self.detector.__class__.__name__ == "DetectorDiferenca",
        ))
