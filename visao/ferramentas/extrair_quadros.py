"""Tira quadros de um vídeo para anotar (ajuste fino do detector de pessoas).

Uso: python ferramentas/extrair_quadros.py VIDEO --saida dataset/images [--intervalo 2] [--max 400]

Guarda um quadro a cada `--intervalo` segundos e pula os quase iguais ao
último guardado (loja parada), para não anotar a mesma cena cem vezes.
"""
import argparse
from pathlib import Path

import cv2
import numpy as np


def extrair(video: str, saida: str, intervalo: float = 2.0, maximo: int = 0, diferenca_minima: float = 4.0) -> int:
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise SystemExit(f"Não consegui abrir {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    passo = max(1, round(fps * intervalo))
    pasta = Path(saida)
    pasta.mkdir(parents=True, exist_ok=True)
    prefixo = Path(video).stem
    ultimo, i, salvos = None, 0, 0
    while True:
        ok, quadro = cap.read()
        if not ok:
            break
        if i % passo == 0:
            pequeno = cv2.cvtColor(cv2.resize(quadro, (64, 36)), cv2.COLOR_BGR2GRAY).astype(np.int16)
            if ultimo is None or float(np.abs(pequeno - ultimo).mean()) >= diferenca_minima:
                cv2.imwrite(str(pasta / f"{prefixo}_{i:07d}.jpg"), quadro, [cv2.IMWRITE_JPEG_QUALITY, 92])
                ultimo = pequeno
                salvos += 1
                if maximo and salvos >= maximo:
                    break
        i += 1
    cap.release()
    return salvos


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--saida", required=True)
    ap.add_argument("--intervalo", type=float, default=2.0, help="segundos entre quadros")
    ap.add_argument("--max", type=int, default=0, help="para depois de N quadros (0 = sem limite)")
    ap.add_argument("--diferenca-minima", type=float, default=4.0, help="0 guarda também os quadros repetidos")
    a = ap.parse_args()
    print(extrair(a.video, a.saida, a.intervalo, a.max, a.diferenca_minima), "quadros salvos em", a.saida)
