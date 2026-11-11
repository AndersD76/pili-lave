"""Arquivo cifrado com AES-256-GCM; a chave fica protegida pelo DPAPI do Windows.

A chave nunca fica em claro no disco: `chave.dpapi` só abre na mesma conta do
Windows, na mesma máquina. Copiar a pasta `dados/` para outro computador não
serve para nada.
"""
import ctypes
import os
from ctypes import wintypes
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _dpapi(dados: bytes, proteger: bool) -> bytes:
    crypt32 = ctypes.windll.crypt32
    entrada = _Blob(len(dados), ctypes.cast(ctypes.create_string_buffer(dados, len(dados)), ctypes.POINTER(ctypes.c_char)))
    saida = _Blob()
    fn = crypt32.CryptProtectData if proteger else crypt32.CryptUnprotectData
    # 0x1 = CRYPTPROTECT_UI_FORBIDDEN
    if not fn(ctypes.byref(entrada), None, None, None, None, 0x1, ctypes.byref(saida)):
        raise OSError("DPAPI falhou (a chave foi criada por outra conta do Windows ou em outra máquina?)")
    try:
        return ctypes.string_at(saida.pbData, saida.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(saida.pbData)


def _gravar_atomico(caminho: Path, dados: bytes) -> None:
    tmp = caminho.with_suffix(caminho.suffix + ".tmp")
    with open(tmp, "wb") as f:
        f.write(dados)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, caminho)


class Cofre:
    def __init__(self, pasta: Path):
        self.pasta = Path(pasta)
        self.pasta.mkdir(parents=True, exist_ok=True)
        arquivo_chave = self.pasta / "chave.dpapi"
        if arquivo_chave.exists():
            chave = _dpapi(arquivo_chave.read_bytes(), proteger=False)
        else:
            chave = AESGCM.generate_key(bit_length=256)
            _gravar_atomico(arquivo_chave, _dpapi(chave, proteger=True))
        self._aes = AESGCM(chave)

    def gravar(self, nome: str, dados: bytes) -> None:
        nonce = os.urandom(12)
        _gravar_atomico(self.pasta / nome, nonce + self._aes.encrypt(nonce, dados, nome.encode()))

    def ler(self, nome: str) -> bytes | None:
        caminho = self.pasta / nome
        if not caminho.exists():
            return None
        bruto = caminho.read_bytes()
        return self._aes.decrypt(bruto[:12], bruto[12:], nome.encode())
