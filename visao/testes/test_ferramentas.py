"""Ferramentas do ajuste fino: tirar quadros de um vídeo e converter YOLO -> COCO."""
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ferramentas"))

from extrair_quadros import extrair  # noqa: E402
from yolo_para_coco import converter  # noqa: E402


def _video(caminho, quadros_parados=50, quadros_mexendo=50, fps=10):
    v = cv2.VideoWriter(str(caminho), cv2.VideoWriter_fourcc(*"mp4v"), fps, (320, 180))
    assert v.isOpened()
    fundo = np.full((180, 320, 3), 90, np.uint8)
    for _ in range(quadros_parados):
        v.write(fundo)
    for i in range(quadros_mexendo):
        q = fundo.copy()
        cv2.rectangle(q, (i * 5, 40), (i * 5 + 60, 170), (255, 255, 255), -1)
        v.write(q)
    v.release()


def test_extrai_um_quadro_por_intervalo_e_pula_os_repetidos(tmp_path):
    _video(tmp_path / "loja.mp4")
    # 10 s de vídeo, 1 quadro por segundo: 5 s parados viram 1 só, 5 s mexendo viram 5
    assert extrair(tmp_path / "loja.mp4", tmp_path / "a", intervalo=1.0) == 6
    assert len(list((tmp_path / "a").glob("loja_*.jpg"))) == 6
    assert extrair(tmp_path / "loja.mp4", tmp_path / "b", intervalo=1.0, diferenca_minima=0) == 10
    assert extrair(tmp_path / "loja.mp4", tmp_path / "c", intervalo=1.0, maximo=3) == 3


def test_yolo_para_coco_nos_dois_arranjos_de_pasta(tmp_path):
    img = np.zeros((200, 400, 3), np.uint8)
    # arranjo do LabelImg: imagem e .txt juntos
    junto = tmp_path / "junto"
    junto.mkdir()
    cv2.imwrite(str(junto / "a.jpg"), img)
    (junto / "a.txt").write_text("0 0.5 0.5 0.25 0.5\n0 0.1 0.1 0.2 0.2\n", encoding="utf-8")
    cv2.imwrite(str(junto / "vazia.jpg"), img)
    (junto / "classes.txt").write_text("pessoa\n", encoding="utf-8")
    coco = converter(junto, ["pessoa"])
    assert [i["file_name"] for i in coco["images"]] == ["a.jpg", "vazia.jpg"]
    assert coco["images"][0]["width"] == 400 and coco["images"][0]["height"] == 200
    assert coco["annotations"][0]["bbox"] == [150.0, 50.0, 100.0, 100.0]
    assert coco["annotations"][1]["bbox"] == [0.0, 0.0, 80.0, 40.0]
    assert {a["image_id"] for a in coco["annotations"]} == {1} and coco["categories"] == [{"id": 1, "name": "pessoa"}]
    # arranjo do Roboflow: images/ e labels/
    rf = tmp_path / "rf"
    (rf / "images").mkdir(parents=True)
    (rf / "labels").mkdir()
    cv2.imwrite(str(rf / "images" / "b.jpg"), img)
    (rf / "labels" / "b.txt").write_text("0 0.5 0.5 1.0 1.0\n", encoding="utf-8")
    assert converter(rf, ["pessoa"])["annotations"][0]["bbox"] == [0.0, 0.0, 400.0, 200.0]
