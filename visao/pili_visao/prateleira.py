"""Presença/ausência de produto numa zona de prateleira.

Dois detectores com a mesma interface: `medir` tira a "foto" da zona e
`comparar` diz quanto mudou (negativo = saiu, positivo = voltou, 0 = nada).
"""
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class Medida:
    cinza: np.ndarray
    contagem: int | None = None


class DetectorPrateleira:
    def medir(self, recorte_bgr: np.ndarray, masc: np.ndarray) -> Medida:
        raise NotImplementedError

    def comparar(self, ref: Medida, atual: Medida, masc: np.ndarray, vazia: np.ndarray | None = None, area_item: float | None = None) -> int:
        raise NotImplementedError


def _cinza(recorte_bgr: np.ndarray) -> np.ndarray:
    return cv2.GaussianBlur(cv2.cvtColor(recorte_bgr, cv2.COLOR_BGR2GRAY), (5, 5), 0)


class DetectorDiferenca(DetectorPrateleira):
    """Compara a zona com a imagem de referência anterior. O sinal vem da
    prateleira vazia, quando ela foi fotografada; senão, da textura (produto
    tem mais borda que prateleira lisa). A quantidade é estimada pela área."""

    def __init__(self, limiar_pixel=30, fracao_minima=0.02, fracao_maxima=0.6):
        self.limiar_pixel = limiar_pixel
        self.fracao_minima = fracao_minima
        self.fracao_maxima = fracao_maxima

    def medir(self, recorte_bgr, masc) -> Medida:
        return Medida(_cinza(recorte_bgr))

    def comparar(self, ref, atual, masc, vazia=None, area_item=None) -> int:
        dentro = masc > 0
        total = int(dentro.sum())
        if total == 0 or ref.cinza.shape != atual.cinza.shape:
            return 0
        d = atual.cinza.astype(np.int16) - ref.cinza.astype(np.int16)
        d -= int(np.median(d[dentro]))  # mudança geral de luz não conta
        mudou = ((np.abs(d) > self.limiar_pixel) & dentro).astype(np.uint8)
        mudou = cv2.morphologyEx(mudou, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
        fracao = mudou.sum() / total
        if fracao < self.fracao_minima or fracao > self.fracao_maxima:
            return 0
        if vazia is not None and vazia.shape == ref.cinza.shape:
            antes = float(np.abs(ref.cinza.astype(np.int16) - vazia)[mudou].mean())
            depois = float(np.abs(atual.cinza.astype(np.int16) - vazia)[mudou].mean())
        else:
            regiao = cv2.dilate(mudou.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
            antes = float(np.abs(cv2.Laplacian(ref.cinza, cv2.CV_32F))[regiao].mean())
            depois = float(np.abs(cv2.Laplacian(atual.cinza, cv2.CV_32F))[regiao].mean())
        sinal = -1 if depois < antes else 1
        cheio = cv2.morphologyEx(mudou.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
        quantidade = max(1, round(cheio.sum() / total / area_item)) if area_item else 1
        return sinal * quantidade


class DetectorSku(DetectorPrateleira):
    """Conta itens com um YOLO treinado no SKU-110K (classe única "objeto")."""

    def __init__(self, pesos: str, confianca=0.3, dispositivo="cpu"):
        from ultralytics import YOLO

        self.modelo = YOLO(pesos)
        self.confianca = confianca
        self.dispositivo = dispositivo

    def medir(self, recorte_bgr, masc) -> Medida:
        r = self.modelo(recorte_bgr, conf=self.confianca, device=self.dispositivo, verbose=False)[0]
        n = 0
        alt, larg = masc.shape
        for x1, y1, x2, y2 in r.boxes.xyxy.cpu().tolist():
            cx, cy = int((x1 + x2) / 2), int((y1 + y2) / 2)
            if 0 <= cx < larg and 0 <= cy < alt and masc[cy, cx] > 0:
                n += 1
        return Medida(_cinza(recorte_bgr), n)

    def comparar(self, ref, atual, masc, vazia=None, area_item=None) -> int:
        return (atual.contagem or 0) - (ref.contagem or 0)


def criar_detector(cfg_prateleira: dict, dispositivo="cpu") -> DetectorPrateleira:
    if cfg_prateleira.get("detector") == "sku" and cfg_prateleira.get("pesosSku"):
        return DetectorSku(cfg_prateleira["pesosSku"], cfg_prateleira.get("confiancaSku", 0.3), dispositivo)
    return DetectorDiferenca(
        cfg_prateleira["limiarPixel"], cfg_prateleira["fracaoMinima"], cfg_prateleira["fracaoMaxima"]
    )
