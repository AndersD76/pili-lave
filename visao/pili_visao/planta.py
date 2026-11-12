"""Planta baixa da loja: leva o pé de cada pessoa, em cada câmera, para metros
no chão. É o que permite seguir a mesma pessoa de uma câmera para a outra:
dois rastros no mesmo ponto do chão ao mesmo tempo são a mesma pessoa.

Cada câmera calibrada tem, no config, "chao": {"imagem": [[x, y] × 4 ou mais,
de 0 a 1], "planta": [[X, Y] × 4 ou mais, em metros]} (ver calibrar_chao.py).
Câmera sem "chao" continua funcionando como antes, sem passagem entre câmeras.
"""
import cv2
import numpy as np

SEGUNDOS_AO_VIVO = 1.0   # posição mais velha que isso não vale como "agora"
MARGEM_DUVIDA = 0.3      # dois candidatos com distâncias tão próximas = não dá pra dizer


class Planta:
    def __init__(self, cfg: dict):
        p = cfg.get("planta") or {}
        self.largura = float(p.get("largura", 6.0))
        self.profundidade = float(p.get("profundidade", 2.4))
        self.raio = float(p.get("raioMetros", 0.8))
        self.raio_perdido = float(p.get("raioPerdidoMetros", 1.5))
        self.segundos_perdido = float(p.get("segundosPerdido", 15))
        self.h: dict[str, np.ndarray] = {}
        for cam in cfg.get("cameras", []):
            chao = cam.get("chao") or {}
            img, pl = chao.get("imagem") or [], chao.get("planta") or []
            if len(img) >= 4 and len(img) == len(pl):
                h, _ = cv2.findHomography(np.float32(img), np.float32(pl))
                if h is not None:
                    self.h[cam["nome"]] = h
        self.posicoes: dict[tuple, tuple] = {}   # (câmera, id) -> (x, y, quando, visita)
        self.ultima: dict[str, tuple] = {}       # visita -> (x, y, quando)

    def calibrada(self, camera: str) -> bool:
        return camera in self.h

    def para_planta(self, camera: str, pe) -> tuple[float, float] | None:
        """Ponto do pé (0 a 1 na imagem) -> metros na planta."""
        h = self.h.get(camera)
        if h is None:
            return None
        x, y = cv2.perspectiveTransform(np.float32([[pe]]), h)[0][0]
        return float(x), float(y)

    def atualizar(self, chave: tuple, pos, agora: float, visita: str | None) -> None:
        if pos is None:
            return
        self.posicoes[chave] = (pos[0], pos[1], agora, visita)
        if visita:
            self.ultima[visita] = (pos[0], pos[1], agora)

    def esquecer(self, chave: tuple) -> None:
        self.posicoes.pop(chave, None)

    def vizinho(self, camera: str, pos, agora: float, excluir=()) -> str | None:
        """De quem é o rastro que acabou de aparecer em `camera` na posição
        `pos`? Procura (1) alguém visto AGORA por outra câmera no mesmo ponto
        do chão e (2) alguém que sumiu há pouco ali perto (ponto cego).
        `excluir` = visitas que já têm rastro vivo nesta câmera. None = ninguém,
        ou dois candidatos tão próximos que não dá pra dizer qual."""
        if pos is None:
            return None
        candidatos: dict[str, float] = {}
        vistos_agora = set()
        for (cam, _), (x, y, quando, visita) in self.posicoes.items():
            if not visita or agora - quando > SEGUNDOS_AO_VIVO:
                continue
            vistos_agora.add(visita)
            if cam == camera or visita in excluir:
                continue
            d = float(np.hypot(pos[0] - x, pos[1] - y))
            if d <= self.raio and d < candidatos.get(visita, 1e9):
                candidatos[visita] = d
        for visita, (x, y, quando) in self.ultima.items():
            if visita in vistos_agora or visita in excluir or agora - quando > self.segundos_perdido:
                continue
            d = float(np.hypot(pos[0] - x, pos[1] - y))
            if d <= self.raio_perdido and d < candidatos.get(visita, 1e9):
                candidatos[visita] = d
        if not candidatos:
            return None
        ordem = sorted(candidatos.items(), key=lambda c: c[1])
        if len(ordem) > 1 and ordem[1][1] - ordem[0][1] < MARGEM_DUVIDA:
            return None
        return ordem[0][0]

    def limpar(self, agora: float, abertas: set | None = None) -> None:
        for chave, (_, _, quando, _) in list(self.posicoes.items()):
            if agora - quando > self.segundos_perdido:
                del self.posicoes[chave]
        for visita, (_, _, quando) in list(self.ultima.items()):
            if agora - quando > self.segundos_perdido and (abertas is None or visita not in abertas):
                del self.ultima[visita]
