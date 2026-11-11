"""
analisar_ciclos.py — resume um log serial da Waveshare 1 (projeto de testes de ruido do RS-485).

Uso:   python analisar_ciclos.py arquivo.log [outro.log ...]

Para cada arquivo mostra:
  - PARADO: taxa de falha do RS-485 com o motor parado (linha de base)
  - cada ciclo "[TESTE] iniciado (bomba ON/OFF)": falha em MOVIMENTO, escritas perdidas de
    vez, como cada giro 2->1 terminou e se o ciclo concluiu ou deu erro
No fim, uma tabela-resumo para comparar varios logs (ex.: antes x depois do filtro).

Falha = transacoes do RS-485 sem nenhum byte de resposta ("zero_bytes") + com CRC errado.
Os contadores do firmware sao acumulados; um reset da W1 zera tudo (tratado aqui).
"""
import re
import sys

RE_RS = re.compile(r'\[RS485\] ok=(\d+) zero_bytes=(\d+) curta=(\d+) crc=(\d+).*?mov=(-?\d+) giro=(-?\d+) home=(-?\d+)')


def janelas(linhas):
    """Devolve (delta_ok, delta_zero, delta_curta, delta_crc, mov, giro, home) por janela de 5 s."""
    prev = None
    saida = []
    for l in linhas:
        m = RE_RS.search(l)
        if not m:
            continue
        ok, z, c, crc, mov, giro, home = map(int, m.groups())
        atual = (ok, z, c, crc)
        if prev is None or any(a < b for a, b in zip(atual, prev)):   # 1a janela ou reset da W1
            prev = atual
            continue
        saida.append((ok - prev[0], z - prev[1], c - prev[2], crc - prev[3], mov, giro, home))
        prev = atual
    return saida


def taxa(ws):
    ok = sum(w[0] for w in ws)
    falha = sum(w[1] + w[2] + w[3] for w in ws)
    total = ok + falha
    return ok, falha, (100.0 * falha / total if total else 0.0)


def analisa(caminho):
    linhas = open(caminho, encoding='utf-8', errors='replace').read().splitlines()
    ini = [i for i, l in enumerate(linhas) if '[TESTE] iniciado' in l]
    print('=' * 78)
    print(caminho)
    print('=' * 78)

    antes = linhas[:ini[0]] if ini else linhas
    parado = [w for w in janelas(antes) if not w[4] and not w[5] and not w[6]]
    if parado:
        ok, f, pct = taxa(parado)
        print(f'PARADO (linha de base): {ok + f} transacoes, falha {pct:.1f}%  ({len(parado)} janelas de 5 s)')
    else:
        print('PARADO: sem janelas (log nao pegou o motor parado antes do 1o ciclo)')

    resumo = []
    for k, i in enumerate(ini):
        fim = ini[k + 1] if k + 1 < len(ini) else len(linhas)
        seg = linhas[i:fim]
        bomba = 'ON' if 'bomba ON' in linhas[i] else 'OFF'
        mov = [w for w in janelas(seg) if w[4] or w[5]]
        ok, f, pct = taxa(mov)
        perdidas = sum('FALHA escrita' in s for s in seg)
        concluiu = any('estado=6' in s for s in seg)
        erros = [s.strip()[:90] for s in seg if '[AUTO] ERRO' in s]
        parou = any('PARADO pelo operador' in s for s in seg)
        resultado = 'CONCLUIU' if concluiu and not erros else ('ERRO: ' + erros[0] if erros else ('PARADO PELO OPERADOR' if parou else 'incompleto'))
        print(f'\nCICLO {k + 1}  bomba {bomba}: movimento {ok + f} transacoes, falha {pct:.0f}%  | escritas perdidas: {perdidas}  | {resultado}')
        for s in seg:
            if re.search(r'\[GIRO\] (2->1 fim giro|fine-home|TIMEOUT)', s):
                print('    ' + s.strip()[:120])
        resumo.append((caminho.replace('\\', '/').split('/')[-1], k + 1, bomba, pct, perdidas, resultado))
    return resumo


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    tudo = []
    for c in sys.argv[1:]:
        tudo += analisa(c)
    if tudo:
        print('\n' + '=' * 78)
        print('RESUMO')
        print(f'{"arquivo":34} {"ciclo":>5} {"bomba":>5} {"falha%":>7} {"perdidas":>8}  resultado')
        for a, k, b, pct, p, r in tudo:
            print(f'{a[:34]:34} {k:5d} {b:>5} {pct:6.0f}% {p:8d}  {r}')


if __name__ == '__main__':
    main()
