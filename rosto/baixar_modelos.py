"""Baixa os dois modelos do OpenCV Zoo e confere o SHA-256."""
import hashlib
import urllib.request

import config

ZOO = "https://github.com/opencv/opencv_zoo/raw/main/models/"
MODELOS = {
    "face_detection_yunet_2023mar.onnx": (
        ZOO + "face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    ),
    "face_recognition_sface_2021dec.onnx": (
        ZOO + "face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    ),
}

if __name__ == "__main__":
    config.MODELOS.mkdir(exist_ok=True)
    for nome, (url, sha) in MODELOS.items():
        destino = config.MODELOS / nome
        if not destino.exists():
            print("baixando", nome)
            urllib.request.urlretrieve(url, destino)
        if hashlib.sha256(destino.read_bytes()).hexdigest() != sha:
            destino.unlink()
            raise SystemExit(f"{nome}: arquivo diferente do esperado, apagado. Rode de novo.")
        print("ok", nome)
