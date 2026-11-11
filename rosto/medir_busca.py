"""Mede o tempo da busca 1:N com assinaturas sintéticas: python medir_busca.py [n]"""
import sys
import time

import numpy as np

from base import Base

n = int(sys.argv[1]) if len(sys.argv) > 1 else 50_000
rng = np.random.default_rng(1)
base = Base(None)
t = time.perf_counter()
for i, emb in enumerate(rng.standard_normal((n, 128)).astype(np.float32)):
    base.cadastrar(f"c{i}", emb, salvar=False)
print(f"{n} assinaturas carregadas em {time.perf_counter() - t:.2f}s")

consultas = rng.standard_normal((200, 128)).astype(np.float32)
tempos = []
for q in consultas:
    t = time.perf_counter()
    base.identificar(q, 0.5, 0.05)
    tempos.append((time.perf_counter() - t) * 1000)
print(f"busca: mediana {np.median(tempos):.2f} ms, p99 {np.percentile(tempos, 99):.2f} ms")
