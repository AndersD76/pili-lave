import base64
import sys
import urllib.request
from pathlib import Path

import cv2
import pytest

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

import config  # noqa: E402

IMAGENS = Path(__file__).parent / "imagens"
# Imagens de exemplo das próprias bibliotecas (não entram no repositório).
FONTES = {
    "lena.jpg": "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/lena.jpg",
    "astronaut.png": "https://raw.githubusercontent.com/scikit-image/scikit-image/v0.22.0/skimage/data/astronaut.png",
}
TOKEN = "token-de-teste"


def _imagem(nome: str):
    caminho = IMAGENS / nome
    if not caminho.exists():
        IMAGENS.mkdir(exist_ok=True)
        try:
            urllib.request.urlretrieve(FONTES[nome], caminho)
        except OSError:
            pytest.skip(f"sem internet para baixar {nome}")
    img = cv2.imread(str(caminho))
    if img is None:
        pytest.skip(f"{nome} inválida")
    return img


@pytest.fixture(scope="session")
def lena():
    return _imagem("lena.jpg")


@pytest.fixture(scope="session")
def astronauta():
    return _imagem("astronaut.png")


def b64(img) -> str:
    return base64.b64encode(cv2.imencode(".jpg", img)[1].tobytes()).decode()


@pytest.fixture
def cliente(tmp_path, monkeypatch):
    """Serviço com base vazia numa pasta temporária e token conhecido."""
    from fastapi.testclient import TestClient

    import app as servico

    monkeypatch.setattr(config, "DADOS", tmp_path)
    monkeypatch.setattr(config, "token_local", lambda: TOKEN)
    servico.base.cache_clear()
    with TestClient(servico.app, headers={"x-loja-token": TOKEN}, client=("192.168.0.50", 5000)) as c:
        yield c
    servico.base.cache_clear()
