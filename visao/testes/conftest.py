"""Loja de mentira: quadros sintéticos, rastros injetados e relógio falso."""
import copy
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pili_visao import config as cfgmod  # noqa: E402
from pili_visao.armazenamento import Armazenamento  # noqa: E402
from pili_visao.loja import Emissor  # noqa: E402
from pili_visao.porta import BarreiraSimulada, MonitorPorta, SireneSimulada  # noqa: E402
from pili_visao.prateleira import criar_detector  # noqa: E402
from pili_visao.processador import ProcessadorCamera  # noqa: E402
from pili_visao.rastreio import Rastro, RastreadorRoteiro  # noqa: E402
from pili_visao.visitas import VinculoVisitas  # noqa: E402

LARG, ALT = 640, 360
T0 = 1_800_000_000.0
PASSO = 0.2

ZONA_A = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.4], [0.1, 0.4]]
ZONA_B = [[0.55, 0.1], [0.95, 0.1], [0.95, 0.4], [0.55, 0.4]]
PORTA = [[0.4, 0.75], [0.6, 0.75], [0.6, 1.0], [0.4, 1.0]]

ITENS_A = [(80, 50), (150, 50), (220, 50)]  # canto de cada item (40x60) dentro da zona A
CAIXA_PORTA = (290, 280, 350, 355)
CAIXA_ZONA_A = (150, 100, 230, 260)
CAIXA_ZONA_A2 = (240, 100, 310, 260)


def _fundo() -> np.ndarray:
    rng = np.random.default_rng(7)
    ruido = rng.integers(60, 200, (ALT // 20, LARG // 20), dtype=np.uint8)
    cinza = cv2.GaussianBlur(cv2.resize(ruido, (LARG, ALT), interpolation=cv2.INTER_CUBIC), (31, 31), 0)
    return cv2.cvtColor(cinza, cv2.COLOR_GRAY2BGR)


FUNDO = _fundo()


def quadro(itens=ITENS_A, pessoas=()) -> np.ndarray:
    q = FUNDO.copy()
    for x, y in itens:
        for i in range(0, 40, 5):
            for j in range(0, 60, 5):
                cor = (30, 30, 220) if (i + j) // 5 % 2 else (240, 240, 240)
                q[y + j:y + j + 5, x + i:x + i + 5] = cor
    for x1, y1, x2, y2 in pessoas:
        q[y1:y2, x1:x2] = (40, 40, 40)
    return q


class Loja:
    """Junta um ProcessadorCamera com tudo de mentira em volta."""

    def __init__(self, tmp_path, cfg_extra=None, barreira=True):
        self.cfg = copy.deepcopy(cfgmod.PADRAO)
        self.cfg["dados"]["pasta"] = str(tmp_path / "dados")
        for secao, valores in (cfg_extra or {}).items():
            self.cfg[secao].update(valores)
        self.camera = {"nome": "cam1", "fonte": 0, "zonaPorta": PORTA,
                       "zonas": [{"nome": "A", "poligono": ZONA_A}, {"nome": "B", "poligono": ZONA_B}]}
        self.ativas: list[dict] = []
        self.recebidos: list[dict] = []
        self.no_ar = True
        self.arm = Armazenamento(tmp_path / "dados", 7)
        self.emissor = Emissor(self._enviar, self.arm.fila)
        self.vinculo = VinculoVisitas(lambda: list(self.ativas), 2)
        self.sirene = SireneSimulada()
        self.porta = MonitorPorta(self.sirene, BarreiraSimulada(barreira), self.cfg["porta"]["sireneSegundos"])
        self.rastreador = RastreadorRoteiro([])
        self.proc = ProcessadorCamera(self.cfg, self.camera, self.rastreador, criar_detector(self.cfg["prateleira"]),
                                      self.vinculo, self.emissor, self.arm, self.porta)
        self.agora = T0

    def _enviar(self, evento) -> bool:
        if self.no_ar:
            self.recebidos.append(evento)
        return self.no_ar

    def entra(self, visita_id: str):
        self.ativas.append({"visitaId": visita_id, "nuvemUserId": "u-" + visita_id, "nome": visita_id,
                            "entrouEm": f"2027-01-15T10:00:{len(self.ativas):02d}Z"})

    def rodar(self, n: int, itens=ITENS_A, pessoas=None, passo=PASSO, imagem=None):
        """n quadros com os mesmos itens e as mesmas pessoas ({id: caixa})."""
        pessoas = pessoas or {}
        for _ in range(n):
            self.rastreador.roteiro.append([Rastro(i, c) for i, c in pessoas.items()])
            q = imagem if imagem is not None else quadro(itens, list(pessoas.values()))
            self.proc.processar(q, self.agora)
            self.agora += passo

    def sem_quadro(self, n: int, passo=PASSO):
        for _ in range(n):
            self.proc.processar(None, self.agora)
            self.agora += passo

    def eventos(self, tipo: str) -> list[dict]:
        return [e for e in self.recebidos if e["tipo"] == tipo]


@pytest.fixture
def loja(tmp_path):
    return Loja(tmp_path)
