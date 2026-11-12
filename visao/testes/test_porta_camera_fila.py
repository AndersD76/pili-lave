import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np

from conftest import CAIXA_PORTA, CAIXA_ZONA_A, ITENS_A, Loja, quadro
from pili_visao.loja import ClienteLoja, Emissor, EventoRejeitado, novo_evento

# ---------- porta ----------


def test_entrada_sem_visita_e_invasao_e_sirene_desliga_30s_depois(loja):
    loja.rodar(10)
    loja.rodar(30, pessoas={1: CAIXA_PORTA})         # 6 s na porta, sem visita aberta
    eventos = loja.eventos("PORTA")
    assert len(eventos) == 1
    e = eventos[0]
    assert e["detalhe"] == "INVASAO" and e["visitasNaZona"] == [] and e["delta"] == 1
    assert 0 < os.path.getsize(e["imagens"][0]) < 400_000
    assert e["clipe"] is None or os.path.getsize(e["clipe"]) > 0
    assert loja.sirene.ligada

    loja.rodar(20, pessoas={1: CAIXA_ZONA_A})        # ainda no campo de visão
    assert loja.sirene.ligada
    loja.rodar(20, passo=1.0)                        # sumiu há 20 s
    assert loja.sirene.ligada
    loja.rodar(3, pessoas={7: CAIXA_ZONA_A}, passo=1.0)   # voltou: a contagem recomeça
    loja.rodar(25, passo=1.0)
    assert loja.sirene.ligada
    loja.rodar(8, passo=1.0)
    assert not loja.sirene.ligada
    assert len(loja.eventos("PORTA")) == 1


def test_entrada_com_visita_nao_e_invasao(loja):
    loja.rodar(10)
    loja.rodar(5, pessoas={1: CAIXA_PORTA})          # a visita é registrada 1 s depois
    loja.entra("v1")
    loja.rodar(30, pessoas={1: CAIXA_PORTA})
    assert loja.eventos("PORTA") == [] and not loja.sirene.ligada
    assert loja.vinculo.visita_de(("cam1", 1)) == "v1"


def test_sem_confirmacao_da_barreira_nao_dispara(tmp_path):
    loja = Loja(tmp_path, barreira=False)
    loja.rodar(10)
    loja.rodar(30, pessoas={1: CAIXA_PORTA})
    assert loja.eventos("PORTA") == [] and not loja.sirene.ligada


def test_rastro_trocado_herda_a_visita(loja):
    loja.entra("v1")
    loja.entra("v2")
    loja.rodar(10)
    loja.rodar(4, pessoas={1: CAIXA_PORTA})
    loja.rodar(3, pessoas={1: CAIXA_ZONA_A})
    loja.rodar(8)                                    # o rastreador perdeu a pessoa
    loja.rodar(3, pessoas={5: CAIXA_ZONA_A})         # e ela voltou com outro número
    assert loja.vinculo.visita_de(("cam1", 5)) == "v2"

# ---------- câmera ----------


def test_camera_caida_avisa_uma_vez_e_avisa_quando_volta(loja):
    loja.rodar(5)
    loja.sem_quadro(100)                             # 20 s sem imagem
    eventos = loja.eventos("CAMERA")
    assert [e["detalhe"] for e in eventos] == ["CAIU"]
    assert eventos[0]["zona"] == "cam1"
    loja.rodar(2)
    assert [e["detalhe"] for e in loja.eventos("CAMERA")] == ["CAIU", "VOLTOU"]


def test_camera_desalinhada_avisa_e_nao_inventa_furto(tmp_path):
    loja = Loja(tmp_path, {"camera": {"intervaloAlinhamentoSegundos": 0}})
    loja.rodar(10)
    torto = np.roll(quadro(), 40, axis=1)            # a câmera levou uma pancada
    loja.rodar(20, imagem=torto)
    assert [e["detalhe"] for e in loja.eventos("CAMERA")] == ["DESALINHADA"]
    assert loja.eventos("PRATELEIRA") == []
    loja.rodar(3)
    assert loja.eventos("CAMERA")[-1]["detalhe"] == "ALINHADA"


def test_camera_tapada(tmp_path):
    loja = Loja(tmp_path, {"camera": {"intervaloAlinhamentoSegundos": 0}})
    loja.rodar(10)
    loja.rodar(10, imagem=np.zeros_like(quadro()))
    assert [e["detalhe"] for e in loja.eventos("CAMERA")] == ["TAPADA"]
    assert loja.eventos("PRATELEIRA") == []

# ---------- fila e HTTP ----------


def test_fila_offline_guarda_e_manda_em_ordem(loja):
    loja.entra("v1")
    loja.no_ar = False
    loja.rodar(10)
    loja.rodar(4, pessoas={1: CAIXA_PORTA})
    loja.rodar(3, itens=ITENS_A[:2], pessoas={1: CAIXA_ZONA_A})
    loja.rodar(12, itens=ITENS_A[:2])
    assert loja.recebidos == [] and len(loja.emissor.pendentes()) == 1

    outro = Emissor(loja._enviar, loja.arm.fila)     # o programa reiniciou: a fila continua no disco
    assert len(outro.pendentes()) == 1
    loja.no_ar = True
    outro.emitir(novo_evento("CAMERA", "cam1", loja.agora, detalhe="VOLTOU"))
    assert [e["tipo"] for e in loja.recebidos] == ["PRATELEIRA", "CAMERA"]
    assert outro.pendentes() == []


def test_evento_recusado_nao_trava_a_fila(tmp_path):
    recebidos = []

    def enviar(evento):
        if evento["zona"] == "ruim":
            raise EventoRejeitado("HTTP 400")
        recebidos.append(evento["zona"])
        return True

    emissor = Emissor(lambda e: False, tmp_path)
    for zona in ("a", "ruim", "b"):
        emissor.emitir(novo_evento("PRATELEIRA", zona, time.time(), delta=-1))
    emissor.enviar = enviar
    assert emissor.descarregar() == 2 and recebidos == ["a", "b"]
    assert emissor.pendentes() == [] and len(list(tmp_path.glob("*.rejeitado"))) == 1


class _Loja3100(BaseHTTPRequestHandler):
    pedidos: list = []

    def _responder(self, corpo):
        dados = json.dumps(corpo).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def do_GET(self):
        self.pedidos.append(("GET", self.path, self.headers.get("x-loja-token"), None))
        self._responder([{"visitaId": "v1", "nuvemUserId": "u1", "nome": "Ana", "entrouEm": "2027-01-15T10:00:00Z"}])

    def do_POST(self):
        corpo = json.loads(self.rfile.read(int(self.headers["content-length"])))
        self.pedidos.append(("POST", self.path, self.headers.get("x-loja-token"), corpo))
        self._responder({"ok": True})

    def log_message(self, *a):
        pass


def test_cliente_http_fala_o_contrato_da_loja():
    _Loja3100.pedidos = []
    servidor = HTTPServer(("127.0.0.1", 0), _Loja3100)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    try:
        cliente = ClienteLoja(f"http://127.0.0.1:{servidor.server_port}", "segredo")
        assert cliente.visitas_ativas()[0]["visitaId"] == "v1"
        evento = novo_evento("PRATELEIRA", "A", time.time(), delta=-1, visitas=["v1"], imagens=["C:/x/antes.jpg"])
        assert cliente.enviar_evento(evento)
    finally:
        servidor.shutdown()
        servidor.server_close()
    get, post = _Loja3100.pedidos
    assert get[:3] == ("GET", "/api/visitas/ativas", "segredo")
    assert post[:3] == ("POST", "/api/visao/eventos", "segredo")
    assert set(post[3]) >= {"tipo", "zona", "delta", "visitasNaZona", "imagens", "ocorridoEm"}

    fora = ClienteLoja(f"http://127.0.0.1:{servidor.server_port}", "segredo", timeout=0.5)
    assert fora.visitas_ativas() is None and fora.enviar_evento(evento) is False

# ---------- limpeza ----------


def test_imagem_grande_sai_reduzida(loja):
    grande = np.random.default_rng(1).integers(0, 255, (1080, 1920, 3), dtype=np.uint8)   # pior caso: ruído puro
    caminho = loja.arm.salvar_jpeg("cam1", "grande", grande, time.time())
    assert os.path.getsize(caminho) < 400_000


def test_limpeza_apaga_so_o_que_passou_do_prazo(loja):
    velho = loja.arm.salvar_jpeg("cam1", "velho", quadro(), time.time() - 30 * 86400)
    novo = loja.arm.salvar_jpeg("cam1", "novo", quadro(), time.time())
    antigo = time.time() - 8 * 86400
    os.utime(velho, (antigo, antigo))
    assert loja.arm.limpar(forcar=True) == 1
    assert not os.path.exists(velho) and os.path.exists(novo)


def test_loja_fora_do_ar_nao_e_consultada_a_cada_quadro(loja):
    chamadas = []
    loja.vinculo.buscar_ativas = lambda: chamadas.append(1)      # devolve None = sem resposta
    loja.rodar(50)                                               # 10 s de quadros
    assert len(chamadas) == 1
    loja.rodar(50)                                               # passou a espera: tenta de novo
    assert len(chamadas) == 2

