#!/usr/bin/env python3
"""Prova de que, com LINK_W1_W2_UART = 0, os arquivos modificados da Fase 2 resolvem para o ORIGINAL de producao.

Resolve so os condicionais da chave (#if LINK_W1_W2_UART, #if !LINK_W1_W2_UART, #else, #endif correspondente) com valor 0 e compara, linha
a linha, com o original. As UNICAS diferencas permitidas sao as linhas '#include "link_cfg.h"' (que define a chave). Qualquer outra diferenca
faz o script falhar (exit 1).

Uso:  python prova_chave0.py <novo> <original>      (rodar de testes/w1_w2_por_rxtx)
"""
import re, sys

PERMITIDAS = {'#include "link_cfg.h"'}
RE_IF_CHAVE  = re.compile(r'^\s*#\s*if\s+(!?)\s*LINK_W1_W2_UART\s*(//.*)?$')
RE_IF_OUTRO  = re.compile(r'^\s*#\s*(if|ifdef|ifndef)\b')
RE_ELSE      = re.compile(r'^\s*#\s*else\b')
RE_ENDIF     = re.compile(r'^\s*#\s*endif\b')

def resolver(linhas, valor=0):
    saida, pilha = [], []              # pilha: ('chave', ativo_agora) | ('outro',)
    def emitindo():
        return all(a for t, *r in pilha if t == 'chave' for a in [r[0]])
    for l in linhas:
        m = RE_IF_CHAVE.match(l)
        if m:
            neg = (m.group(1) == '!')
            ativo = (valor != 0) != neg          # (#if LINK) com valor 0 -> falso ; (#if !LINK) -> verdadeiro
            pilha.append(('chave', ativo)); continue
        if RE_IF_OUTRO.match(l):
            pilha.append(('outro',))
            if emitindo(): saida.append(l)
            continue
        if RE_ELSE.match(l):
            if pilha and pilha[-1][0] == 'chave':
                pilha[-1] = ('chave', not pilha[-1][1]); continue
            if emitindo(): saida.append(l)
            continue
        if RE_ENDIF.match(l):
            t = pilha.pop() if pilha else ('outro',)
            if t[0] == 'chave': continue
            if emitindo(): saida.append(l)
            continue
        if emitindo(): saida.append(l)
    if pilha: raise SystemExit("condicionais desbalanceados")
    return saida

def main():
    novo, orig = sys.argv[1], sys.argv[2]
    ln = open(novo, encoding='utf-8', errors='replace', newline='').read().split('\n')
    lo = open(orig, encoding='utf-8', errors='replace', newline='').read().split('\n')
    res = [x for x in resolver(ln, 0) if x.rstrip('\r') not in PERMITIDAS]
    dif = [(i, a, b) for i, (a, b) in enumerate(zip(res, lo)) if a != b]
    if len(res) != len(lo) or dif:
        print(f"FALHOU: {novo} (chave 0) != {orig}: {len(res)} x {len(lo)} linhas, {len(dif)} diferentes")
        for i, a, b in dif[:5]: print(f"  linha {i+1}:\n    novo : {a!r}\n    orig : {b!r}")
        sys.exit(1)
    print(f"OK: {novo} com LINK_W1_W2_UART=0 e IDENTICO a {orig} ({len(lo)} linhas; unica linha ignorada: #include \"link_cfg.h\")")

if __name__ == '__main__':
    main()
