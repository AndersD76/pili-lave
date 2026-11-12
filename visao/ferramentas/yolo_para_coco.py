"""Converte anotações no formato YOLO (um .txt por imagem) para COCO JSON.

O YOLOX, que é o detector do programa, treina com COCO JSON; o LabelImg e a
exportação "YOLO" do Roboflow entregam .txt. Esta ponte evita reanotar.

Uso: python ferramentas/yolo_para_coco.py dataset/train --saida dataset/train.json [--classes pessoa]

A pasta pode ter images/ e labels/ (Roboflow) ou imagens e .txt juntos
(LabelImg). Imagem sem .txt, ou com .txt vazio, entra como "sem ninguém".
"""
import argparse
import json
from pathlib import Path

import cv2

EXTENSOES = {".jpg", ".jpeg", ".png", ".bmp"}


def converter(pasta: str, classes: list[str]) -> dict:
    raiz = Path(pasta)
    pasta_img = raiz / "images" if (raiz / "images").is_dir() else raiz
    pasta_txt = raiz / "labels" if (raiz / "labels").is_dir() else raiz
    coco = {"images": [], "annotations": [],
            "categories": [{"id": i + 1, "name": n} for i, n in enumerate(classes)]}
    for arquivo in sorted(p for p in pasta_img.iterdir() if p.suffix.lower() in EXTENSOES):
        img = cv2.imread(str(arquivo))
        if img is None:
            continue
        alt, larg = img.shape[:2]
        id_img = len(coco["images"]) + 1
        coco["images"].append({"id": id_img, "file_name": arquivo.name, "width": larg, "height": alt})
        txt = pasta_txt / (arquivo.stem + ".txt")
        if not txt.exists():
            continue
        for linha in txt.read_text(encoding="utf-8").splitlines():
            partes = linha.split()
            if len(partes) < 5:
                continue
            classe = int(partes[0])
            if classe >= len(classes):
                raise SystemExit(f"{txt.name}: classe {classe} não está em --classes ({classes})")
            cx, cy, w, h = (float(v) for v in partes[1:5])
            x, y = max(0.0, (cx - w / 2) * larg), max(0.0, (cy - h / 2) * alt)
            w, h = min(w * larg, larg - x), min(h * alt, alt - y)
            coco["annotations"].append({
                "id": len(coco["annotations"]) + 1, "image_id": id_img, "category_id": classe + 1,
                "bbox": [round(x, 2), round(y, 2), round(w, 2), round(h, 2)], "area": round(w * h, 2), "iscrowd": 0,
            })
    return coco


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("pasta")
    ap.add_argument("--saida", required=True)
    ap.add_argument("--classes", nargs="+", default=["pessoa"])
    a = ap.parse_args()
    coco = converter(a.pasta, a.classes)
    Path(a.saida).write_text(json.dumps(coco), encoding="utf-8")
    vazias = len(coco["images"]) - len({x["image_id"] for x in coco["annotations"]})
    print(f"{len(coco['images'])} imagens ({vazias} sem ninguém), {len(coco['annotations'])} caixas -> {a.saida}")
