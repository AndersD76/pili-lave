"""Base de assinaturas de rosto (embeddings) e a busca 1:N por cosseno.

Só a assinatura é guardada — nunca a foto. Fica tudo em memória numa matriz
normalizada e, no disco, num único arquivo cifrado (ver cofre.py).
"""
import io
import threading
from dataclasses import dataclass

import numpy as np

from cofre import Cofre

ARQUIVO = "assinaturas.bin"


@dataclass
class Resultado:
    encontrado: bool
    cliente_id: str | None
    score: float


class Base:
    def __init__(self, cofre: Cofre | None, dim: int = 128):
        self._cofre = cofre
        self._trava = threading.Lock()
        self._ids: list[str] = []
        self._pos: dict[str, int] = {}
        self._m = np.zeros((0, dim), dtype=np.float32)
        self._n = 0
        bruto = cofre.ler(ARQUIVO) if cofre else None
        if bruto:
            with np.load(io.BytesIO(bruto), allow_pickle=False) as z:
                self._ids = [str(i) for i in z["ids"]]
                self._m = np.ascontiguousarray(z["m"], dtype=np.float32)
            self._n = len(self._ids)
            self._pos = {c: i for i, c in enumerate(self._ids)}

    def __len__(self) -> int:
        return self._n

    def _salvar(self) -> None:
        if not self._cofre:
            return
        buf = io.BytesIO()
        np.savez(buf, ids=np.array(self._ids, dtype=str), m=self._m[: self._n])
        self._cofre.gravar(ARQUIVO, buf.getvalue())

    def cadastrar(self, cliente_id: str, emb: np.ndarray, salvar: bool = True) -> None:
        emb = _normalizar(emb)
        with self._trava:
            i = self._pos.get(cliente_id)
            if i is None:
                if self._n == len(self._m):
                    novo = np.zeros((max(1024, len(self._m) * 2), self._m.shape[1]), dtype=np.float32)
                    novo[: self._n] = self._m[: self._n]
                    self._m = novo
                i = self._n
                self._ids.append(cliente_id)
                self._pos[cliente_id] = i
                self._n += 1
            self._m[i] = emb
            if salvar:
                self._salvar()

    def remover(self, cliente_id: str) -> bool:
        with self._trava:
            i = self._pos.pop(cliente_id, None)
            if i is None:
                return False
            ultimo = self._n - 1
            if i != ultimo:
                self._m[i] = self._m[ultimo]
                self._ids[i] = self._ids[ultimo]
                self._pos[self._ids[i]] = i
            self._ids.pop()
            self._n -= 1
            self._salvar()
            return True

    def salvar(self) -> None:
        with self._trava:
            self._salvar()

    def identificar(self, emb: np.ndarray, limiar: float, margem: float, candidatos: list[str] | None = None) -> Resultado:
        emb = _normalizar(emb)
        with self._trava:
            if candidatos is not None:
                idx = np.array(sorted({self._pos[c] for c in candidatos if c in self._pos}), dtype=np.int64)
                if idx.size == 0:
                    return Resultado(False, None, 0.0)
                scores = self._m[idx] @ emb
            else:
                if self._n == 0:
                    return Resultado(False, None, 0.0)
                idx = None
                scores = self._m[: self._n] @ emb
            melhor = int(np.argmax(scores))
            s1 = float(scores[melhor])
            if scores.size > 1:
                s2 = float(np.partition(scores, -2)[-2])
            else:
                s2 = -1.0
            cliente = self._ids[int(idx[melhor]) if idx is not None else melhor]
        if s1 >= limiar and s1 - s2 >= margem:
            return Resultado(True, cliente, s1)
        return Resultado(False, None, s1)


def _normalizar(emb: np.ndarray) -> np.ndarray:
    emb = np.asarray(emb, dtype=np.float32).reshape(-1)
    norma = float(np.linalg.norm(emb))
    if norma == 0:
        raise ValueError("assinatura vazia")
    return emb / norma
