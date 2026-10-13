import Link from "next/link";
import { listaDeCompras, sugestaoDeCompra } from "@/lib/compras";
import { reais } from "@/lib/dinheiro";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/sessao";
import { Nav } from "../nav";
import { limparLista, salvarMarcacoes } from "./actions";
import { Imprimir } from "./Imprimir";

export const dynamic = "force-dynamic";

type Visao = "minimo" | "todos";

/**
 * Lista de compras. Em cima, a lista como está (o que levar pro fornecedor:
 * imprime ou baixa em planilha). Embaixo, a tabela de escolha: o lojista
 * decide se quer ver só os produtos abaixo do mínimo ou todos, marca os que
 * vai comprar e ajusta a quantidade. O que recebe entrada sai da lista sozinho.
 */
export default async function Compras({
  searchParams,
}: {
  searchParams: Promise<{ v?: string; q?: string; erro?: string; ok?: string }>;
}) {
  const { loja, usuario } = await exigirPermissao("COMPRAS");
  const { v, q: qParam, erro, ok } = await searchParams;
  const visao: Visao = v === "todos" ? "todos" : "minimo";
  const q = qParam?.trim() ?? "";
  const soNumeros = q.replace(/\D/g, "");

  const [lista, ativos] = await Promise.all([
    listaDeCompras(),
    prisma.produto.findMany({
      where: {
        ativo: true,
        ...(q ? { OR: [{ nome: { contains: q } }, ...(soNumeros ? [{ ean: { contains: soNumeros } }] : [])] } : {}),
      },
      orderBy: { nome: "asc" },
    }),
  ]);
  const naLista = new Map(lista.linhas.map((l) => [l.produtoId, l.quantidade]));
  const abaixo = (p: { estoqueAtual: number; estoqueMinimo: number }) => p.estoqueAtual <= p.estoqueMinimo;
  const produtos = visao === "todos" ? ativos : ativos.filter(abaixo);
  const nAbaixo = ativos.filter(abaixo).length;
  const voltar = `/gestao/compras?v=${visao}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <main className="admin-wrap">
      <div className="nao-imprimir">
        <Nav loja={loja} usuario={usuario} atual="/gestao/compras" />
      </div>

      <h2 className="section-title" style={{ marginTop: 0 }}>
        Lista de compras — {loja.nome} ({lista.total.itens})
      </h2>
      {lista.linhas.length === 0 ? (
        <p className="sub">Nenhum item na lista. Marque os produtos na tabela abaixo e clique em Salvar marcações.</p>
      ) : (
        <>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Produto</th><th>Código de barras</th><th>Comprar</th><th>Em estoque</th><th>Último custo</th><th>Estimado</th><th>Último fornecedor</th>
                </tr>
              </thead>
              <tbody>
                {lista.linhas.map((l) => (
                  <tr key={l.produtoId}>
                    <td>{l.nome}</td>
                    <td>{l.ean ?? "—"}</td>
                    <td><b>{l.quantidade} {l.unidade}</b></td>
                    <td>{l.estoque}</td>
                    <td>{reais(l.custoCents)}</td>
                    <td>{reais(l.totalCents)}</td>
                    <td>{l.fornecedor || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: 10 }}>
            <b>{lista.total.itens}</b> {lista.total.itens === 1 ? "item" : "itens"}, <b>{lista.total.unidades}</b> unidades,
            estimado em <b>{reais(lista.total.valorCents)}</b> pelo último custo.
          </p>
          <div className="linha-form nao-imprimir" style={{ marginTop: 12 }}>
            <Imprimir />
            <a className="btn ghost" href="/gestao/compras/csv" style={{ height: 40, display: "inline-flex", alignItems: "center" }}>
              Baixar planilha (CSV)
            </a>
            <form action={limparLista}>
              <button className="btn ghost" type="submit" style={{ height: 40 }}>Esvaziar a lista</button>
            </form>
          </div>
          <p className="sub nao-imprimir" style={{ marginTop: 8 }}>
            Quando um produto da lista recebe entrada (nota fiscal ou manual), ele sai da lista sozinho.
          </p>
        </>
      )}

      <div className="nao-imprimir">
        <h2 className="section-title">Escolher o que comprar</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {([["minimo", `Abaixo do mínimo (${nAbaixo})`], ["todos", `Todos os produtos (${ativos.length})`]] as const).map(([k, rotulo]) => (
            <Link
              key={k} href={`/gestao/compras?v=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`btn ${k === visao ? "" : "ghost"}`}
              style={{ height: 36, padding: "0 16px", fontSize: 13, display: "inline-flex", alignItems: "center" }}
            >
              {rotulo}
            </Link>
          ))}
        </div>
        <form method="get" className="linha-form" style={{ marginBottom: 12 }}>
          <input type="hidden" name="v" value={visao} />
          <label className="rotulo" style={{ flex: 1 }}>
            Buscar por nome ou código de barras
            <input className="field" name="q" defaultValue={q} />
          </label>
          <button className="btn ghost" type="submit" style={{ height: 40 }}>Buscar</button>
        </form>
        {erro && <p className="err-msg" style={{ marginBottom: 10 }}>{erro}</p>}
        {ok && <p className="ok-msg" style={{ marginBottom: 10 }}>{ok === "lista" ? "Lista de compras atualizada." : "Quantidades salvas."}</p>}

        {produtos.length === 0 ? (
          <p className="sub">
            {visao === "minimo" ? "Nenhum produto no estoque mínimo ou abaixo. Para comprar mesmo assim, veja Todos os produtos." : "Nenhum produto encontrado."}
          </p>
        ) : (
          <form action={salvarMarcacoes}>
            <input type="hidden" name="ids" value={produtos.map((p) => p.id).join(",")} />
            <input type="hidden" name="voltar" value={voltar} />
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>Comprar?</th><th>Produto</th><th>Estoque</th><th>Mínimo</th><th>Quantidade a comprar</th><th>Último custo</th></tr>
                </thead>
                <tbody>
                  {produtos.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <input
                          type="checkbox" name={`sel_${p.id}`} defaultChecked={naLista.has(p.id)}
                          aria-label={`Comprar ${p.nome}`} style={{ width: 20, height: 20 }}
                        />
                      </td>
                      <td>{p.nome}</td>
                      <td>
                        <span className={`chip ${p.estoqueAtual <= 0 ? "err" : abaixo(p) ? "at" : "ok"}`}>{p.estoqueAtual} {p.unidade}</span>
                      </td>
                      <td>{p.estoqueMinimo}</td>
                      <td>
                        <input
                          className="field" name={`qtd_${p.id}`} inputMode="numeric"
                          defaultValue={naLista.get(p.id) ?? sugestaoDeCompra(p.estoqueAtual, p.estoqueMinimo)}
                          aria-label={`Quantidade de ${p.nome}`}
                          style={{ width: 100, height: 36, fontSize: 14, padding: "0 10px" }}
                        />
                      </td>
                      <td>{reais(p.custoCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
              <button className="btn" type="submit">Salvar marcações</button>
              <span className="sub">
                Marque o que vai comprar e ajuste a quantidade. Desmarcar um produto que aparece aqui tira ele da lista.
              </span>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
