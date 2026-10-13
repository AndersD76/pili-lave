import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { reais } from "@/lib/dinheiro";
import { produtosCriticos } from "@/lib/estoque";
import { exigirGestao } from "@/lib/sessao";
import { pode } from "@/lib/permissoes";
import { Nav } from "./nav";
import { definirPercentuais } from "./produtos/actions";

export const dynamic = "force-dynamic";

/** Painel: o que precisa de atenção agora — o que comprar (estoque no
 *  mínimo) e o que ainda não pode ser vendido (sem preço). */
export default async function Painel({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { loja, usuario } = await exigirGestao();
  const { erro, ok } = await searchParams;
  const podePreco = pode(usuario, "PRECO");
  const [ativos, criticos, semPreco] = await Promise.all([
    prisma.produto.findMany({ where: { ativo: true }, select: { estoqueAtual: true, custoCents: true } }),
    produtosCriticos(),
    prisma.produto.findMany({ where: { ativo: true, precoCents: null }, orderBy: { nome: "asc" } }),
  ]);
  const [semPct, manuais] = await Promise.all([
    prisma.produto.count({ where: { ativo: true, precoManual: false, margemPct: null } }),
    prisma.produto.count({ where: { ativo: true, precoManual: true } }),
  ]);
  const valorEmEstoque = ativos.reduce((soma, p) => soma + Math.max(0, p.estoqueAtual) * p.custoCents, 0);

  return (
    <main className="admin-wrap">
      <Nav loja={loja} usuario={usuario} atual="/gestao" />
      {erro && <p className="err-msg" style={{ marginBottom: 16 }}>{erro}</p>}

      <div className="stats">
        <div className="stat">
          <div className="lab">Produtos ativos</div>
          <div className="val">{ativos.length}</div>
        </div>
        <div className={`stat${criticos.length > 0 ? " alerta" : ""}`}>
          <div className="lab">Para comprar</div>
          <div className="val">{criticos.length}</div>
          <div className="sub">no estoque mínimo ou abaixo</div>
        </div>
        <div className={`stat${semPreco.length > 0 ? " alerta" : ""}`}>
          <div className="lab">Sem preço de venda</div>
          <div className="val">{semPreco.length}</div>
          <div className="sub">não podem ser vendidos</div>
        </div>
        <Link href="/gestao/produtos?f=sempct" className={`stat${semPct > 0 ? " alerta" : ""}`} style={{ color: "inherit" }}>
          <div className="lab">Sem percentual</div>
          <div className="val">{semPct}</div>
          <div className="sub">preço não acompanha o custo</div>
        </Link>
        <Link href="/gestao/produtos?f=manual" className="stat" style={{ color: "inherit" }}>
          <div className="lab">Sem reajuste automático</div>
          <div className="val">{manuais}</div>
          <div className="sub">preço fixado à mão</div>
        </Link>
        <div className="stat">
          <div className="lab">Valor em estoque</div>
          <div className="val">{reais(valorEmEstoque)}</div>
          <div className="sub">a preço de custo</div>
        </div>
      </div>

      <h2 className="section-title">Para comprar ({criticos.length})</h2>
      {pode(usuario, "COMPRAS") && (
        <p className="sub" style={{ marginBottom: 10 }}>
          <Link href="/gestao/compras">Montar a lista de compras →</Link>
        </p>
      )}
      {criticos.length === 0 ? (
        <p className="sub">Nenhum produto no estoque mínimo.</p>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Produto</th><th>Código de barras</th><th>Estoque</th><th>Mínimo</th><th>Faltam</th></tr>
            </thead>
            <tbody>
              {criticos.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/gestao/produtos/${p.id}`}>{p.nome}</Link></td>
                  <td>{p.ean ?? "—"}</td>
                  <td>
                    <span className={`chip ${p.estoqueAtual <= 0 ? "err" : "at"}`}>{p.estoqueAtual}</span>
                  </td>
                  <td>{p.estoqueMinimo}</td>
                  {/* quanto comprar pra passar do mínimo */}
                  <td>{p.estoqueMinimo - p.estoqueAtual + 1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {semPreco.length > 0 && (
        <>
          <h2 className="section-title">Sem preço de venda ({semPreco.length})</h2>
          <p className="sub" style={{ marginBottom: 10 }}>
            Estes produtos ainda não podem ser vendidos.
            {podePreco && " Informe o percentual de venda de cada um (40 = custo mais 40%) e clique em Salvar percentuais: o preço é calculado na hora e passa a acompanhar o custo."}
          </p>
          {ok && <p className="ok-msg" style={{ marginBottom: 10 }}>Percentuais salvos.</p>}
          {/* um formulário só pra tabela inteira: preenche vários e salva de uma vez */}
          <form action={definirPercentuais}>
            <input type="hidden" name="voltar" value="painel" />
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>Produto</th><th>Custo</th><th>Estoque</th>{podePreco && <th>% de venda</th>}</tr>
                </thead>
                <tbody>
                  {semPreco.map((p) => (
                    <tr key={p.id}>
                      <td><Link href={`/gestao/produtos/${p.id}`}>{p.nome}</Link></td>
                      <td>{reais(p.custoCents)}</td>
                      <td>{p.estoqueAtual}</td>
                      {podePreco && (
                        <td>
                          <input
                            className="field" name={`pct_${p.id}`} inputMode="decimal" placeholder="ex.: 40"
                            style={{ width: 110, height: 38, fontSize: 14, padding: "0 10px" }}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {podePreco && <button className="btn" type="submit" style={{ marginTop: 12 }}>Salvar percentuais</button>}
          </form>
        </>
      )}
    </main>
  );
}
