"""Mede a velocidade do detector de pessoas nesta máquina.

Uso:  python medir_fps.py                 (YOLOX-s e YOLOX-tiny, numa foto e na webcam)
      python medir_fps.py --comparar      (inclui o YOLO da Ultralytics, se instalado)
      python medir_fps.py --fonte video.mp4
"""
import argparse
import time
from pathlib import Path

import cv2
import numpy as np

from pili_visao.rastreio import RastreadorYolox

RAIZ = Path(__file__).resolve().parent


def quadros_da_fonte(fonte, n):
    cap = cv2.VideoCapture(int(fonte) if str(fonte).isdigit() else str(fonte))
    quadros = []
    for _ in range(10):          # descarta os primeiros (câmera ajustando)
        cap.read()
    while len(quadros) < n:
        ok, q = cap.read()
        if not ok:
            break
        quadros.append(q)
    cap.release()
    return quadros


def medir(nome, rastreador, quadros):
    for q in quadros[:3]:
        rastreador.atualizar(q)
    tempos, contagem = [], []
    for q in quadros:
        t0 = time.perf_counter()
        r = rastreador.atualizar(q)
        tempos.append(time.perf_counter() - t0)
        contagem.append(len(r))
    ms = float(np.median(tempos)) * 1000
    print(f"  {nome:<28} {ms:6.0f} ms/quadro  = {1000 / ms:5.1f} quadros/s   pessoas por quadro (média): {np.mean(contagem):.2f}")
    return contagem


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fonte", default="0")
    ap.add_argument("--quadros", type=int, default=40)
    ap.add_argument("--comparar", action="store_true")
    args = ap.parse_args()

    quadros = quadros_da_fonte(args.fonte, args.quadros)
    if not quadros:
        raise SystemExit("Não consegui ler quadros dessa fonte.")
    print(f"fonte {args.fonte}: {len(quadros)} quadros de {quadros[0].shape[1]}x{quadros[0].shape[0]}")
    resultados = {}
    for nome in ("yolox_s", "yolox_tiny"):
        pesos = RAIZ / "modelos" / f"{nome}.onnx"
        if pesos.exists():
            resultados[nome] = medir(f"{nome} (Apache-2.0)", RastreadorYolox(pesos), quadros)
    if args.comparar:
        from pili_visao.rastreio import RastreadorYolo
        resultados["ultralytics"] = medir("yolo11n Ultralytics (AGPL)", RastreadorYolo("yolo11n.pt", "auto", 480), quadros)
        for nome in ("yolox_s", "yolox_tiny"):
            if nome in resultados:
                iguais = sum(a == b for a, b in zip(resultados[nome], resultados["ultralytics"]))
                print(f"  {nome} contou o mesmo número de pessoas que o Ultralytics em {iguais} de {len(quadros)} quadros")


if __name__ == "__main__":
    main()
