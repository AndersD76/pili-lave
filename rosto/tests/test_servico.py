import cv2
import numpy as np

from conftest import b64


def _variacao(img):
    """Mesma pessoa, outra "foto": menor, mais escura e levemente girada."""
    h, w = img.shape[:2]
    girada = cv2.warpAffine(img, cv2.getRotationMatrix2D((w / 2, h / 2), 6, 1.0), (w, h))
    return cv2.convertScaleAbs(cv2.resize(girada, (480, 480)), alpha=0.75, beta=8)


def test_sem_token_e_recusado(cliente):
    assert cliente.get("/saude", headers={"x-loja-token": "errado"}).status_code == 401
    assert cliente.post("/identificar", json={"imagemBase64": "x"}, headers={"x-loja-token": ""}).status_code == 401


def test_cadastra_e_identifica(cliente, lena, astronauta):
    assert cliente.get("/saude").json() == {"ok": True, "clientes": 0}
    assert cliente.post("/cadastrar", json={"clienteId": "lena", "imagemBase64": b64(lena)}).json()["ok"]
    assert cliente.get("/saude").json()["clientes"] == 1

    r = cliente.post("/identificar", json={"imagemBase64": b64(_variacao(lena))}).json()
    assert r["encontrado"] and r["clienteId"] == "lena" and r["score"] > 0.5

    r = cliente.post("/identificar", json={"imagemBase64": b64(astronauta)}).json()
    assert r == {"encontrado": False, "score": r["score"], "motivo": "NAO_RECONHECIDO"}
    assert r["score"] < 0.3


def test_candidatos(cliente, lena, astronauta):
    cliente.post("/cadastrar", json={"clienteId": "lena", "imagemBase64": b64(lena)})
    cliente.post("/cadastrar", json={"clienteId": "astro", "imagemBase64": b64(astronauta)})
    foto = b64(_variacao(astronauta))
    assert cliente.post("/identificar", json={"imagemBase64": foto, "candidatos": ["lena", "astro"]}).json()["clienteId"] == "astro"
    r = cliente.post("/identificar", json={"imagemBase64": foto, "candidatos": ["lena"]}).json()
    assert not r["encontrado"] and r["motivo"] == "NAO_RECONHECIDO"


def test_erros_de_imagem(cliente, lena, astronauta):
    preta = b64(np.zeros((300, 300, 3), np.uint8))
    r = cliente.post("/cadastrar", json={"clienteId": "x", "imagemBase64": preta})
    assert r.status_code == 422 and r.json()["erro"] == "SEM_ROSTO"

    duas = b64(np.hstack([lena, cv2.resize(astronauta, (512, 512))]))
    r = cliente.post("/cadastrar", json={"clienteId": "x", "imagemBase64": duas})
    assert r.status_code == 422 and r.json()["erro"] == "MAIS_DE_UM_ROSTO"

    r = cliente.post("/cadastrar", json={"clienteId": "x", "imagemBase64": "isto-nao-e-imagem"})
    assert r.status_code == 422 and r.json()["erro"] == "IMAGEM_INVALIDA"

    assert cliente.post("/identificar", json={"imagemBase64": preta}).json()["motivo"] == "SEM_ROSTO"
    assert cliente.get("/saude").json()["clientes"] == 0


def test_remover(cliente, lena):
    cliente.post("/cadastrar", json={"clienteId": "lena", "imagemBase64": b64(lena)})
    assert cliente.delete("/clientes/lena").json() == {"ok": True, "removido": True}
    assert cliente.delete("/clientes/lena").json() == {"ok": True, "removido": False}
    assert not cliente.post("/identificar", json={"imagemBase64": b64(lena)}).json()["encontrado"]


def test_nenhuma_foto_fica_no_disco(cliente, lena, tmp_path):
    cliente.post("/cadastrar", json={"clienteId": "lena", "imagemBase64": b64(lena)})
    arquivos = sorted(p.name for p in tmp_path.iterdir())
    assert arquivos == ["assinaturas.bin", "chave.dpapi"]
    assert (tmp_path / "assinaturas.bin").stat().st_size < 4096
