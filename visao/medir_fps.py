"""Mede quantos quadros por segundo o YOLO + ByteTrack faz nesta máquina."""
import sys
import time

import cv2
from ultralytics.utils import ASSETS

from pili_visao.rastreio import RastreadorYolo

imgsz = int(sys.argv[1]) if len(sys.argv) > 1 else 480
quadro = cv2.resize(cv2.imread(str(ASSETS / "bus.jpg")), (1920, 1080))
r = RastreadorYolo("yolo11n.pt", "auto", imgsz)
for _ in range(3):
    r.atualizar(quadro)
t0 = time.time()
n = 30
for _ in range(n):
    pessoas = r.atualizar(quadro)
print(f"dispositivo={r.dispositivo} imgsz={imgsz} quadro=1920x1080 pessoas={len(pessoas)} -> {n / (time.time() - t0):.1f} quadros/s")
