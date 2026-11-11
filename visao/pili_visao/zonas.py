"""Zonas como máscaras de pixels, a partir de polígonos em coordenadas de 0 a 1."""
import cv2
import numpy as np


def pontos_px(poligono, largura: int, altura: int) -> np.ndarray:
    return np.array([[round(x * largura), round(y * altura)] for x, y in poligono], dtype=np.int32)


def mascara(poligono, largura: int, altura: int, margem: float = 0.0) -> np.ndarray:
    m = np.zeros((altura, largura), dtype=np.uint8)
    if not poligono or len(poligono) < 3:
        return m
    cv2.fillPoly(m, [pontos_px(poligono, largura, altura)], 255)
    if margem > 0:
        lado = max(1, round(margem * max(largura, altura))) * 2 + 1
        m = cv2.dilate(m, np.ones((lado, lado), np.uint8))
    return m


def retangulo(masc: np.ndarray) -> tuple[int, int, int, int]:
    x, y, w, h = cv2.boundingRect(masc)
    return x, y, w, h


def caixa_toca(caixa, masc: np.ndarray) -> bool:
    x1, y1, x2, y2 = (int(round(v)) for v in caixa)
    alt, larg = masc.shape
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(larg, x2), min(alt, y2)
    if x2 <= x1 or y2 <= y1:
        return False
    return bool(masc[y1:y2, x1:x2].any())


def ponto_dentro(ponto, masc: np.ndarray) -> bool:
    x, y = int(round(ponto[0])), int(round(ponto[1]))
    alt, larg = masc.shape
    return 0 <= x < larg and 0 <= y < alt and masc[y, x] > 0


def centro(caixa) -> tuple[float, float]:
    x1, y1, x2, y2 = caixa
    return (x1 + x2) / 2, (y1 + y2) / 2
