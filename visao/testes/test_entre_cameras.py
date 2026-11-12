"""Seguir a pessoa de uma câmera para a outra (planta.py) e o trajeto dela (trajetos.py)."""
import copy
import os

import cv2

from conftest import CAIXA_PORTA, CAIXA_ZONA_A, ITENS_A, PASSO, PORTA, T0, ZONA_A, quadro
from pili_visao import config as cfgmod
from pili_visao.armazenamento import Armazenamento
from pili_visao.loja import Emissor
from pili_visao.planta import Planta
from pili_visao.porta import BarreiraSimulada, MonitorPorta, SireneSimulada
from pili_visao.prateleira import criar_detector
from pili_visao.processador import ProcessadorCamera
from pili_visao.rastreio import Rastro, RastreadorRoteiro
from pili_visao.trajetos import Trajetos
from pili_visao.visitas import VinculoVisitas
from principal import atender_pedidos

# cam1 vê a porta e os 4 m da esquerda; cam2 vê os 4 m da direita (2 m em comum)
CANTOS = [[0, 0], [1, 0], [1, 1], [0, 1]]
CHAO1 = {"imagem": CANTOS, "planta": [[0, 0], [4, 0], [4, 2.4], [0, 2.4]]}
CHAO2 = {"imagem": CANTOS, "planta": [[2, 0], [6, 0], [6, 2.4], [2, 2.4]]}

LONGE_CAM1 = (100, 100, 160, 250)        # x = 0,8 m: só a cam1 enxerga
COMUM_CAM1 = (450, 150, 510, 288)        # x = 3,0 m, visto pela cam1…
COMUM_CAM2 = (130, 150, 190, 288)        # …e o mesmo ponto visto pela cam2
BORDA_CAM1 = (590, 150, 630, 288)        # x = 3,8 m, quase saindo da cam1
ALEM_CAM2 = (370, 150, 430, 288)         # x = 4,5 m, só a cam2


class LojaDuasCameras:
    def __init__(self, tmp_path):
        self.cfg = copy.deepcopy(cfgmod.PADRAO)
        self.cfg["dados"]["pasta"] = str(tmp_path / "dados")
        self.cfg["cameras"] = [
            {"nome": "cam1", "fonte": 0, "zonaPorta": PORTA, "chao": CHAO1, "zonas": []},
            {"nome": "cam2", "fonte": 1, "chao": CHAO2, "zonas": [{"nome": "C", "poligono": ZONA_A}]},
        ]
        self.ativas, self.recebidos = [], []
        self.arm = Armazenamento(tmp_path / "dados", 7)
        self.emissor = Emissor(lambda e: self.recebidos.append(e) or True, self.arm.fila)
        self.vinculo = VinculoVisitas(lambda: list(self.ativas), 2)
        self.porta = MonitorPorta(SireneSimulada(), BarreiraSimulada(True), self.cfg["porta"]["sireneSegundos"])
        self.planta = Planta(self.cfg)
        self.trajetos = Trajetos(tmp_path / "dados", self.planta, self.cfg["trajeto"])
        self.rast, self.proc = {}, {}
        for cam in self.cfg["cameras"]:
            self.rast[cam["nome"]] = RastreadorRoteiro([])
            self.proc[cam["nome"]] = ProcessadorCamera(
                self.cfg, cam, self.rast[cam["nome"]], criar_detector(self.cfg["prateleira"]), self.vinculo,
                self.emissor, self.arm, self.porta, planta=self.planta, trajetos=self.trajetos)
        self.agora = T0

    def entra(self, visita):
        self.ativas.append({"visitaId": visita, "nome": visita, "entrouEm": f"2027-01-15T10:00:{len(self.ativas):02d}Z"})

    def rodar(self, n, cam1=None, cam2=None, itens2=ITENS_A, passo=PASSO):
        for _ in range(n):
            for nome, pessoas, itens in (("cam1", cam1 or {}, ()), ("cam2", cam2 or {}, itens2)):
                self.rast[nome].roteiro.append([Rastro(i, c) for i, c in pessoas.items()])
                self.proc[nome].processar(quadro(itens, list(pessoas.values())), self.agora)
            self.agora += passo

    def dono(self, camera, id_):
        return self.vinculo.visita_de((camera, id_))

    def entram_ana_e_bia(self):
        """Ana entra e vai pro fundo esquerdo; Bia entra depois. Rastros 1 e 2 na cam1."""
        self.rodar(8)
        self.entra("ana")
        self.rodar(4, cam1={1: CAIXA_PORTA})
        self.rodar(3, cam1={1: LONGE_CAM1})
        self.entra("bia")
        self.rodar(4, cam1={1: LONGE_CAM1, 2: CAIXA_PORTA})
        assert self.dono("cam1", 1) == "ana" and self.dono("cam1", 2) == "bia"


def test_calibracao_do_chao():
    planta = Planta({"cameras": [{"nome": "cam2", "chao": CHAO2}, {"nome": "sem"}]})
    assert planta.calibrada("cam2") and not planta.calibrada("sem")
    x, y = planta.para_planta("cam2", (0.25, 0.8))
    assert abs(x - 3.0) < 0.01 and abs(y - 1.92) < 0.01
    assert planta.para_planta("sem", (0.5, 0.5)) is None


def test_pessoa_passa_da_cam1_para_a_cam2_com_duas_visitas_na_loja(tmp_path):
    loja = LojaDuasCameras(tmp_path)
    loja.entram_ana_e_bia()
    # Bia anda até a área comum: a cam2 passa a vê-la e tem que saber que é a Bia, não a Ana
    loja.rodar(4, cam1={1: LONGE_CAM1, 2: COMUM_CAM1}, cam2={7: COMUM_CAM2})
    assert loja.dono("cam2", 7) == "bia"
    # sai do campo da cam1 e segue só na cam2: continua sendo a Bia
    loja.rodar(4, cam1={1: LONGE_CAM1}, cam2={7: ALEM_CAM2})
    assert loja.dono("cam2", 7) == "bia"
    assert not [e for e in loja.recebidos if e["tipo"] == "PORTA"]


def test_item_some_na_cam2_e_o_evento_sai_no_nome_de_quem_veio_da_cam1(tmp_path):
    loja = LojaDuasCameras(tmp_path)
    loja.entram_ana_e_bia()
    loja.rodar(3, cam1={1: LONGE_CAM1, 2: COMUM_CAM1}, cam2={7: COMUM_CAM2})
    loja.rodar(3, cam1={1: LONGE_CAM1}, cam2={7: CAIXA_ZONA_A})
    loja.rodar(3, cam1={1: LONGE_CAM1}, cam2={7: CAIXA_ZONA_A}, itens2=ITENS_A[:2])
    loja.rodar(3, cam1={1: LONGE_CAM1}, cam2={7: ALEM_CAM2}, itens2=ITENS_A[:2])
    loja.rodar(12, cam1={1: LONGE_CAM1}, itens2=ITENS_A[:2])
    eventos = [e for e in loja.recebidos if e["tipo"] == "PRATELEIRA"]
    assert len(eventos) == 1
    assert eventos[0]["zona"] == "C" and eventos[0]["delta"] == -1
    assert eventos[0]["visitasNaZona"] == ["bia"] and eventos[0]["rastrosSemVisita"] == 0


def test_ponto_cego_some_numa_camera_e_reaparece_na_outra(tmp_path):
    loja = LojaDuasCameras(tmp_path)
    loja.entram_ana_e_bia()
    loja.rodar(3, cam1={1: LONGE_CAM1, 2: BORDA_CAM1})
    loja.rodar(10, cam1={1: LONGE_CAM1})                      # 2 s sem ninguém ver a Bia
    loja.rodar(3, cam1={1: LONGE_CAM1}, cam2={9: ALEM_CAM2})  # reaparece 0,7 m adiante
    assert loja.dono("cam2", 9) == "bia"


def test_duas_pessoas_coladas_nao_chuta_quem_e(tmp_path):
    loja = LojaDuasCameras(tmp_path)
    loja.entram_ana_e_bia()
    colada = (430, 150, 490, 288)     # Ana a ~12 cm da Bia, as duas na área comum
    loja.rodar(4, cam1={1: colada, 2: COMUM_CAM1}, cam2={7: COMUM_CAM2})
    assert loja.dono("cam2", 7) is None
    # separaram: agora dá pra dizer
    loja.rodar(3, cam1={1: LONGE_CAM1, 2: COMUM_CAM1}, cam2={7: COMUM_CAM2})
    assert loja.dono("cam2", 7) == "bia"


def test_camera_sem_chao_calibrado_continua_como_antes(tmp_path):
    loja = LojaDuasCameras(tmp_path)
    loja.planta.h.pop("cam2")
    loja.entram_ana_e_bia()
    loja.rodar(4, cam1={1: LONGE_CAM1, 2: COMUM_CAM1}, cam2={7: COMUM_CAM2})
    assert loja.dono("cam2", 7) is None       # duas visitas e sem planta: não sabe quem é


def _passeio_da_bia(loja):
    loja.entram_ana_e_bia()
    loja.rodar(5, cam1={1: LONGE_CAM1, 2: COMUM_CAM1}, cam2={7: COMUM_CAM2})
    loja.rodar(10, cam1={1: LONGE_CAM1}, cam2={7: CAIXA_ZONA_A})
    loja.rodar(5, cam1={1: LONGE_CAM1}, cam2={7: ALEM_CAM2})


def test_trajeto_compilado_tem_mapa_folha_de_fotos_e_resumo(tmp_path):
    loja = LojaDuasCameras(tmp_path)
    _passeio_da_bia(loja)
    pontos = loja.trajetos.pontos("bia")
    assert {p["c"] for p in pontos} == {"cam1", "cam2"}
    assert any(p.get("z") == "C" for p in pontos) and all("x" in p for p in pontos)
    r = loja.trajetos.compilar("bia", "Bia Souza", rotulo="divergencia_d1")
    assert 2 <= len(r["imagens"]) <= 3
    for caminho in r["imagens"]:
        assert os.path.isabs(caminho) and 5_000 < os.path.getsize(caminho) < 400_000
        assert cv2.imread(caminho) is not None
    assert "2 câmera(s)" in r["resumo"] and "prateleiras: C" in r["resumo"]
    # a Ana nunca chegou perto de prateleira
    assert "nenhuma prateleira" in loja.trajetos.compilar("ana", "Ana")["resumo"]
    vazio = loja.trajetos.compilar("ninguem", "X")
    assert vazio["imagens"] == [] and "não têm registro" in vazio["resumo"]


def test_trajeto_respeita_o_periodo_pedido(tmp_path):
    loja = LojaDuasCameras(tmp_path)
    _passeio_da_bia(loja)
    assert loja.trajetos.pontos("bia", inicio=loja.agora + 10) == []
    assert loja.trajetos.compilar("bia", "Bia", inicio=loja.agora + 10)["imagens"] == []


def test_trajeto_sem_planta_desenha_sobre_as_cameras(tmp_path):
    loja = LojaDuasCameras(tmp_path)
    loja.planta.h.clear()
    loja.rodar(8)
    loja.entra("ana")
    loja.rodar(4, cam1={1: CAIXA_PORTA})
    loja.rodar(6, cam1={1: LONGE_CAM1})
    r = loja.trajetos.compilar("ana", "Ana")
    assert len(r["imagens"]) >= 2 and all("x" not in p for p in loja.trajetos.pontos("ana"))


def test_pedido_da_loja_vira_trajeto_enviado(tmp_path):
    loja = LojaDuasCameras(tmp_path)
    _passeio_da_bia(loja)

    class Cliente:
        enviados = []

        def pedidos_trajeto(self):
            return [{"divergenciaId": "d1", "visitaId": "bia", "nome": "Bia", "inicio": None, "fim": None},
                    {"divergenciaId": "d1", "visitaId": "fantasma", "nome": "Sem registro", "inicio": None, "fim": None}]

        def enviar_trajeto(self, t):
            self.enviados.append(t)
            return True

    cliente = Cliente()
    assert atender_pedidos(cliente, loja.trajetos) == 2
    bia, fantasma = cliente.enviados
    assert bia["divergenciaId"] == "d1" and bia["visitaId"] == "bia" and len(bia["imagens"]) >= 2
    assert "divergencia_d1" in bia["imagens"][0]
    assert fantasma["imagens"] == [] and fantasma["resumo"]
