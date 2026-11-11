"""YOLO + ByteTrack de verdade em poucos quadros (imagem de exemplo do Ultralytics)."""
from pathlib import Path

import cv2
import pytest

ultralytics = pytest.importorskip("ultralytics")
pytest.importorskip("lap")

PESOS = Path(__file__).resolve().parent.parent / "yolo11n.pt"


@pytest.mark.skipif(not PESOS.exists(), reason="yolo11n.pt não está em visao/")
def test_yolo_bytetrack_acha_e_mantem_pessoas():
    from ultralytics.utils import ASSETS

    from pili_visao.rastreio import RastreadorYolo

    imagem = cv2.imread(str(ASSETS / "bus.jpg"))
    assert imagem is not None
    rastreador = RastreadorYolo(str(PESOS), "auto", 480, 0.35)
    ids = []
    for _ in range(4):
        rastros = rastreador.atualizar(imagem)
        ids.append(sorted(r.id for r in rastros))
    assert len(ids[-1]) >= 3
    assert ids[-1] == ids[-2]
