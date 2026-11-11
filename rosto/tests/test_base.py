import numpy as np

from base import Base
from cofre import Cofre


def _emb(semente: int) -> np.ndarray:
    return np.random.default_rng(semente).standard_normal(128).astype(np.float32)


def _parecido(emb: np.ndarray, ruido: float) -> np.ndarray:
    return emb + ruido * np.random.default_rng(99).standard_normal(128).astype(np.float32)


def test_acha_o_cliente_certo_entre_milhares():
    base = Base(None)
    for i in range(5000):
        base.cadastrar(f"c{i}", _emb(i), salvar=False)
    r = base.identificar(_parecido(_emb(1234), 0.3), 0.5, 0.05)
    assert r.encontrado and r.cliente_id == "c1234"


def test_desconhecido_nao_e_identificado():
    base = Base(None)
    for i in range(5000):
        base.cadastrar(f"c{i}", _emb(i), salvar=False)
    r = base.identificar(_emb(999_999), 0.5, 0.05)
    assert not r.encontrado and r.cliente_id is None


def test_candidatos_restringe_a_busca():
    base = Base(None)
    for i in range(10):
        base.cadastrar(f"c{i}", _emb(i), salvar=False)
    assert base.identificar(_emb(3), 0.5, 0.05, ["c1", "c3"]).cliente_id == "c3"
    assert not base.identificar(_emb(3), 0.5, 0.05, ["c1", "c2"]).encontrado
    assert not base.identificar(_emb(3), 0.5, 0.05, ["nao-existe"]).encontrado
    assert not base.identificar(_emb(3), 0.5, 0.05, []).encontrado


def test_dois_muito_parecidos_ficam_sem_resposta():
    base = Base(None)
    base.cadastrar("a", _emb(1), salvar=False)
    base.cadastrar("b", _parecido(_emb(1), 0.02), salvar=False)
    assert not base.identificar(_emb(1), 0.5, 0.05).encontrado


def test_recadastrar_substitui_e_remover_apaga():
    base = Base(None)
    base.cadastrar("a", _emb(1), salvar=False)
    base.cadastrar("b", _emb(2), salvar=False)
    base.cadastrar("c", _emb(3), salvar=False)
    base.cadastrar("a", _emb(7), salvar=False)
    assert len(base) == 3
    assert not base.identificar(_emb(1), 0.5, 0.05).encontrado
    assert base.identificar(_emb(7), 0.5, 0.05).cliente_id == "a"
    assert base.remover("a") and not base.remover("a")
    assert len(base) == 2
    assert not base.identificar(_emb(7), 0.5, 0.05).encontrado
    assert base.identificar(_emb(3), 0.5, 0.05).cliente_id == "c"
    assert base.identificar(_emb(2), 0.5, 0.05).cliente_id == "b"


def test_persiste_cifrado(tmp_path):
    base = Base(Cofre(tmp_path))
    base.cadastrar("cliente-secreto-123", _emb(1))
    base.cadastrar("outro", _emb(2))
    base.remover("outro")

    bruto = (tmp_path / "assinaturas.bin").read_bytes()
    assert b"cliente-secreto-123" not in bruto
    assert _emb(1).tobytes()[:32] not in bruto
    assert len((tmp_path / "chave.dpapi").read_bytes()) > 32  # não é a chave crua

    reaberta = Base(Cofre(tmp_path))
    assert len(reaberta) == 1
    assert reaberta.identificar(_emb(1), 0.5, 0.05).cliente_id == "cliente-secreto-123"


def test_arquivo_adulterado_nao_abre(tmp_path):
    import pytest
    from cryptography.exceptions import InvalidTag

    Base(Cofre(tmp_path)).cadastrar("a", _emb(1))
    arquivo = tmp_path / "assinaturas.bin"
    bruto = bytearray(arquivo.read_bytes())
    bruto[40] ^= 1
    arquivo.write_bytes(bytes(bruto))
    with pytest.raises(InvalidTag):
        Base(Cofre(tmp_path))
