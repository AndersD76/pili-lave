"""Associação de caixas (ids estáveis) e o detector YOLOX de verdade, quando o modelo está baixado."""
from pathlib import Path

import numpy as np
import pytest

from pili_visao.rastreio import AssociadorCaixas, DetectorYolox, criar_rastreador

A0 = (100, 100, 160, 260)
B0 = (400, 100, 460, 260)


def _anda(caixa, dx):
    return (caixa[0] + dx, caixa[1], caixa[2] + dx, caixa[3])


def test_ids_ficam_estaveis_com_duas_pessoas_andando():
    assoc = AssociadorCaixas(alta=0.35)
    ids = []
    for i in range(10):
        r = assoc.atualizar([(_anda(A0, 15 * i), 0.9), (_anda(B0, -15 * i), 0.8)])
        ids.append(sorted((x.id, round(x.caixa[0])) for x in r))
    assert all(len(q) == 2 for q in ids)
    assert {q[0][0] for q in ids} == {1} and {q[1][0] for q in ids} == {2}
    assert ids[-1][0][1] == 235 and ids[-1][1][1] == 265     # cada id seguiu a sua pessoa


def test_deteccao_fraca_segura_o_rastro_mas_nao_cria_um_novo():
    assoc = AssociadorCaixas(alta=0.35)
    assert [r.id for r in assoc.atualizar([(A0, 0.9)])] == [1]
    assert [r.id for r in assoc.atualizar([(_anda(A0, 5), 0.2)])] == [1]     # meio encoberta
    assert assoc.atualizar([(B0, 0.2)]) == []                                # fraca e sem rastro: ignora
    assert len(assoc.rastros) == 1


def test_some_por_pouco_tempo_e_volta_com_o_mesmo_id():
    assoc = AssociadorCaixas(alta=0.35, quadros_perdido=5)
    assoc.atualizar([(A0, 0.9)])
    for _ in range(3):
        assert assoc.atualizar([]) == []
    assert [r.id for r in assoc.atualizar([(_anda(A0, 10), 0.9)])] == [1]


def test_some_por_muito_tempo_e_volta_como_outro():
    assoc = AssociadorCaixas(alta=0.35, quadros_perdido=5)
    assoc.atualizar([(A0, 0.9)])
    for _ in range(7):
        assoc.atualizar([])
    assert [r.id for r in assoc.atualizar([(A0, 0.9)])] == [2]


def test_longe_demais_e_outra_pessoa():
    assoc = AssociadorCaixas(alta=0.35)
    assoc.atualizar([(A0, 0.9)])
    assert [r.id for r in assoc.atualizar([(B0, 0.9)])] == [2]


def test_passo_largo_e_acompanhado_pela_velocidade():
    assoc = AssociadorCaixas(alta=0.35)
    for dx in (0, 20, 50, 90, 140, 190):                # acelera até 50 px por quadro, numa caixa de 60 px
        r = assoc.atualizar([(_anda(A0, dx), 0.9)])
    assert [x.id for x in r] == [1]
    # sem a previsão pelo último deslocamento, 50 px de salto não casaria (IoU 0,09)
    parado = AssociadorCaixas(alta=0.35)
    parado.atualizar([(A0, 0.9)])
    assert [x.id for x in parado.atualizar([(_anda(A0, 50), 0.9)])] == [2]


MODELO = Path(__file__).resolve().parent.parent / "modelos" / "yolox_s.onnx"


@pytest.mark.skipif(not MODELO.exists(), reason="modelo não baixado (python baixar_modelos.py)")
def test_yolox_de_verdade_nao_inventa_pessoa_em_imagem_vazia_e_respeita_o_formato():
    det = DetectorYolox(MODELO)
    assert (det.alt, det.larg) == (640, 640)
    vazio = np.full((720, 1280, 3), 127, np.uint8)
    assert [d for d in det.detectar(vazio) if d[1] >= 0.35] == []
    rast = criar_rastreador({"detector": "yolox", "pesos": str(MODELO), "confianca": 0.35, "fpsAlvo": 5})
    assert rast.atualizar(vazio) == [] and rast.dispositivo in ("cpu", 0)


@pytest.mark.skipif(not MODELO.exists(), reason="modelo não baixado (python baixar_modelos.py)")
def test_yolox_de_verdade_acha_as_pessoas_de_uma_foto_conhecida():
    cv2 = pytest.importorskip("cv2")
    assets = pytest.importorskip("ultralytics.utils").ASSETS      # só pela foto de exemplo (bus.jpg)
    img = cv2.imread(str(assets / "bus.jpg"))
    pessoas = [d for d in DetectorYolox(MODELO).detectar(img) if d[1] >= 0.35]
    assert len(pessoas) == 4
    for (x1, y1, x2, y2), _ in pessoas:
        assert 0 <= x1 < x2 <= img.shape[1] + 2 and 0 <= y1 < y2 <= img.shape[0] + 2
