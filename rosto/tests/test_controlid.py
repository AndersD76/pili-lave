import cv2
import pytest

import config
import controlid
from conftest import b64

IP_CATRACA = "192.168.0.50"  # o mesmo "client" do TestClient em conftest.py
URL = "/new_biometric_image.fcgi?device_id=77&identifier_id=1&portal_id=1&width={w}&height={h}"


@pytest.fixture
def loja(monkeypatch):
    """Finge o programa da loja; guarda o que foi perguntado."""
    chamadas = []
    resposta = {"liberado": True, "motivo": None, "mensagem": "Bem-vindo, Lena!", "visitaId": "v1"}

    async def falsa(cliente_id):
        chamadas.append(cliente_id)
        return resposta

    monkeypatch.setattr(controlid, "autorizar_na_loja", falsa)
    monkeypatch.setattr(config, "CONTROLID_IP", IP_CATRACA)
    return chamadas, resposta


def _jpeg(img) -> bytes:
    return cv2.imencode(".jpg", img)[1].tobytes()


def _enviar(cliente, corpo: bytes, w=0, h=0):
    # A catraca não manda o token: sem header nenhum.
    return cliente.post(URL.format(w=w, h=h), content=corpo, headers={"x-loja-token": "", "content-type": "application/octet-stream"}).json()["result"]


def test_reconhecido_e_liberado(cliente, lena, loja):
    chamadas, _ = loja
    cliente.post("/cadastrar", json={"clienteId": "lena", "imagemBase64": b64(lena)})
    r = _enviar(cliente, _jpeg(lena))
    assert r["event"] == 7
    assert r["actions"] == [{"action": "catra", "parameters": "allow=clockwise"}]
    assert r["message"] == "Bem-vindo, Lena!"
    assert chamadas == ["lena"]


def test_imagem_crua_em_tons_de_cinza(cliente, lena, loja):
    cliente.post("/cadastrar", json={"clienteId": "lena", "imagemBase64": b64(lena)})
    cinza = cv2.cvtColor(lena, cv2.COLOR_BGR2GRAY)
    r = _enviar(cliente, cinza.tobytes(), w=cinza.shape[1], h=cinza.shape[0])
    assert r["event"] == 7


def test_loja_nega(cliente, lena, loja):
    _, resposta = loja
    resposta.update(liberado=False, motivo="LOTADA", mensagem="Ocupação máxima esgotada, aguarde")
    cliente.post("/cadastrar", json={"clienteId": "lena", "imagemBase64": b64(lena)})
    r = _enviar(cliente, _jpeg(lena))
    assert r["event"] == 6 and r["actions"] == []
    assert r["message"] == "Ocupação máxima esgotada, aguarde"


def test_desconhecido_nem_pergunta_a_loja(cliente, lena, astronauta, loja):
    chamadas, _ = loja
    cliente.post("/cadastrar", json={"clienteId": "lena", "imagemBase64": b64(lena)})
    r = _enviar(cliente, _jpeg(astronauta))
    assert r["event"] == 3 and r["actions"] == [] and chamadas == []
    assert _enviar(cliente, b"lixo")["event"] == 3


def test_outro_ip_ou_catraca_desligada_nunca_libera(cliente, lena, loja, monkeypatch):
    chamadas, _ = loja
    cliente.post("/cadastrar", json={"clienteId": "lena", "imagemBase64": b64(lena)})
    monkeypatch.setattr(config, "CONTROLID_IP", "10.0.0.9")
    assert _enviar(cliente, _jpeg(lena))["event"] == 6
    monkeypatch.setattr(config, "CONTROLID_IP", "")
    assert _enviar(cliente, _jpeg(lena))["event"] == 6
    monkeypatch.setattr(config, "CONTROLID_IP", IP_CATRACA)
    monkeypatch.setattr(config, "CONTROLID_DEVICE_ID", "outro")
    assert _enviar(cliente, _jpeg(lena))["event"] == 6
    assert chamadas == []


def test_loja_fora_do_ar_nega(cliente, lena, monkeypatch):
    monkeypatch.setattr(config, "CONTROLID_IP", IP_CATRACA)
    monkeypatch.setattr(config, "URL_LOJA", "http://127.0.0.1:9")
    cliente.post("/cadastrar", json={"clienteId": "lena", "imagemBase64": b64(lena)})
    r = _enviar(cliente, _jpeg(lena))
    assert r["event"] == 6 and r["actions"] == []


def test_modos_que_nao_usamos_negam(cliente, loja):
    assert cliente.post("/new_biometric_template.fcgi?portal_id=1", content=b"x").json()["result"]["event"] == 6
    assert cliente.post("/new_user_identified.fcgi", data={"user_id": "6", "event": "7"}).json()["result"]["event"] == 6
    assert cliente.post("/device_is_alive.fcgi", json={"access_logs": 0}).status_code == 200
