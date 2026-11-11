import os

import cv2
import numpy as np

from conftest import ALT, CAIXA_PORTA, CAIXA_ZONA_A, CAIXA_ZONA_A2, ITENS_A, LARG, ZONA_A, quadro
from pili_visao import zonas
from pili_visao.camera import FonteVideo
from pili_visao.prateleira import DetectorDiferenca


def _visita_pega_item(loja, pessoas_na_zona, itens_depois):
    loja.rodar(10)                                   # loja vazia: tira a referência
    loja.rodar(4, pessoas={i: CAIXA_PORTA for i in list(pessoas_na_zona)[:1]})
    loja.rodar(3, pessoas=pessoas_na_zona)
    loja.rodar(3, itens=itens_depois, pessoas=pessoas_na_zona)
    loja.rodar(3, itens=itens_depois, pessoas={i: CAIXA_PORTA for i in list(pessoas_na_zona)[:1]})
    loja.rodar(12, itens=itens_depois)


def test_item_some_com_uma_visita_na_zona(loja):
    loja.entra("v1")
    _visita_pega_item(loja, {1: CAIXA_ZONA_A}, ITENS_A[:2])
    eventos = loja.eventos("PRATELEIRA")
    assert len(eventos) == 1
    e = eventos[0]
    assert e["zona"] == "A" and e["delta"] == -1
    assert e["visitasNaZona"] == ["v1"] and e["rastrosSemVisita"] == 0
    assert len(e["imagens"]) == 3
    assert all(os.path.isabs(i) and os.path.getsize(i) > 0 for i in e["imagens"])
    assert e["ocorridoEm"].endswith("Z")
    assert loja.eventos("PORTA") == []


def test_item_some_com_duas_visitas_manda_as_duas(loja):
    loja.rodar(10)
    loja.entra("v1")
    loja.rodar(4, pessoas={1: CAIXA_PORTA})
    loja.entra("v2")
    loja.rodar(4, pessoas={1: CAIXA_ZONA_A, 2: CAIXA_PORTA})
    loja.rodar(3, pessoas={1: CAIXA_ZONA_A, 2: CAIXA_ZONA_A2})
    loja.rodar(3, itens=ITENS_A[:2], pessoas={1: CAIXA_ZONA_A, 2: CAIXA_ZONA_A2})
    loja.rodar(12, itens=ITENS_A[:2])
    eventos = loja.eventos("PRATELEIRA")
    assert len(eventos) == 1
    assert eventos[0]["visitasNaZona"] == ["v1", "v2"] and eventos[0]["delta"] == -1
    assert loja.eventos("PORTA") == []


def test_item_devolvido_da_delta_positivo(loja):
    loja.entra("v1")
    loja.rodar(10, itens=ITENS_A[:2])
    loja.rodar(4, itens=ITENS_A[:2], pessoas={1: CAIXA_PORTA})
    loja.rodar(3, itens=ITENS_A[:2], pessoas={1: CAIXA_ZONA_A})
    loja.rodar(3, pessoas={1: CAIXA_ZONA_A})
    loja.rodar(12)
    eventos = loja.eventos("PRATELEIRA")
    assert len(eventos) == 1 and eventos[0]["delta"] == 1


def test_passou_e_nao_pegou_nada_nao_gera_evento(loja):
    loja.entra("v1")
    _visita_pega_item(loja, {1: CAIXA_ZONA_A}, ITENS_A)
    assert loja.recebidos == []


def test_sumiu_sem_ninguem_visto_vai_sem_visita(loja):
    loja.rodar(10)
    loja.agora += 60
    loja.rodar(12, itens=ITENS_A[:2])
    eventos = loja.eventos("PRATELEIRA")
    assert len(eventos) == 1 and eventos[0]["visitasNaZona"] == []


def test_luz_mudando_nao_gera_evento(loja):
    loja.rodar(10)
    loja.agora += 60
    loja.rodar(12, imagem=cv2.convertScaleAbs(quadro(), alpha=1.0, beta=25))
    assert loja.eventos("PRATELEIRA") == []


def test_sinal_pela_foto_da_prateleira_vazia():
    masc = zonas.mascara(ZONA_A, LARG, ALT)
    det = DetectorDiferenca()
    vazia = det.medir(quadro(itens=[]), masc).cinza.astype(np.int16)
    cheia, falta_um = det.medir(quadro(), masc), det.medir(quadro(ITENS_A[:2]), masc)
    assert det.comparar(cheia, falta_um, masc, vazia) == -1
    assert det.comparar(falta_um, cheia, masc, vazia) == 1
    area_item = (40 * 60) / (masc > 0).sum()
    sem_dois = det.medir(quadro(ITENS_A[:1]), masc)
    assert det.comparar(cheia, sem_dois, masc, vazia, area_item) == -2


def test_video_gravado_em_arquivo(loja, tmp_path):
    """O mesmo roteiro passando por um arquivo de vídeo de verdade (FonteVideo)."""
    caminho = str(tmp_path / "loja.avi")
    video = cv2.VideoWriter(caminho, cv2.VideoWriter_fourcc(*"MJPG"), 5, (LARG, ALT))
    assert video.isOpened()
    roteiro = [(ITENS_A, {})] * 10 + [(ITENS_A, {1: CAIXA_PORTA})] * 4 + [(ITENS_A, {1: CAIXA_ZONA_A})] * 3 \
        + [(ITENS_A[:2], {1: CAIXA_ZONA_A})] * 3 + [(ITENS_A[:2], {})] * 12
    for itens, pessoas in roteiro:
        video.write(quadro(itens, list(pessoas.values())))
    video.release()

    loja.entra("v1")
    fonte = FonteVideo(caminho)
    assert not fonte.ao_vivo
    lidos = 0
    for itens, pessoas in roteiro:
        q = fonte.ler()
        assert q is not None
        lidos += 1
        loja.rodar(1, pessoas=pessoas, imagem=q)
    assert fonte.ler() is None and lidos == len(roteiro)
    eventos = loja.eventos("PRATELEIRA")
    assert len(eventos) == 1 and eventos[0]["delta"] == -1 and eventos[0]["visitasNaZona"] == ["v1"]
