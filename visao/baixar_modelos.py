"""Baixa o detector de pessoas (YOLOX oficial da Megvii, licença Apache-2.0) para modelos/."""
import urllib.request
from pathlib import Path

BASE = "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/"
PASTA = Path(__file__).resolve().parent / "modelos"

if __name__ == "__main__":
    PASTA.mkdir(exist_ok=True)
    for nome in ("yolox_s.onnx", "yolox_tiny.onnx"):
        destino = PASTA / nome
        if destino.exists():
            print(nome, "já existe")
            continue
        print("baixando", nome, "...")
        urllib.request.urlretrieve(BASE + nome, destino)
    print("pronto")
