import Link from "next/link";
import { contagemSemFornecedor, fornecedoresParaCompra, listaDeCompras } from "@/lib/compras";
import { reais } from "@/lib/dinheiro";
import { exigirPermissao } from "@/lib/sessao";
import { Nav } from "../nav";
import { limparLista } from "./actions";
import { Imprimir } from "./Imprimir";

export const dynamic = "force-dynamic";

/**
 * Lista de compras. Em cima, a lista como está (o que já foi marcado pra
 * comprar, de todos os fornecedores juntos: imprime ou baixa em
 * planilha). Embaixo, a escolha é por fornecedor — cada um tem sua própria
 * tela com os itens dele abaixo do mínimo e os demais.
 */
export default async function Compras() {
  const { loja, usuario } = await exigirPermissao("COMPRAS");
  const [lista, fornecedores, nSemFornecedor] = await Promise.all([listaDeCompras(), fornecedoresParaCompra(), contagemSemFornecedor()]);

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
        <h2 className="section-title">Escolher por fornecedor</h2>
        <p className="sub" style={{ marginTop: -6, marginBottom: 12 }}>
          Cada fornecedor mostra os itens dele abaixo do mínimo; marcar um item ali tira ele da tela dos outros fornecedores até a entrada chegar.
        </p>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Fornecedor</th><th>Itens abaixo do mínimo</th><th>Pedido sugerido</th><th>Pedido mínimo</th><th></th></tr></thead>
            <tbody>
              <tr>
                <td>Sem fornecedor</td>
                <td>{nSemFornecedor}</td>
                <td>—</td>
                <td>—</td>
                <td><Link className="btn ghost" href="/gestao/compras/sem-fornecedor" style={{ height: 32, padding: "0 12px", fontSize: 13 }}>Abrir</Link></td>
              </tr>
              {fornecedores.map((f) => (
                <tr key={f.id}>
                  <td>{f.nome}</td>
                  <td>{f.nAbaixo}</td>
                  <td>{reais(f.valorSugeridoCents)}</td>
                  <td>
                    {f.pedidoMinimoCents === null ? (
                      <span className="sub">não cadastrado</span>
                    ) : f.atingiuMinimo ? (
                      <span className="chip at">atingido ({reais(f.pedidoMinimoCents)})</span>
                    ) : (
                      reais(f.pedidoMinimoCents)
                    )}
                  </td>
                  <td><Link className="btn ghost" href={`/gestao/compras/fornecedor/${f.id}`} style={{ height: 32, padding: "0 12px", fontSize: 13 }}>Abrir</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {fornecedores.length === 0 && (
          <p className="sub" style={{ marginTop: 10 }}>
            Nenhum fornecedor com produto vinculado ainda. Vincule fornecedores na ficha de cada produto, em Produtos e estoque.
          </p>
        )}
      </div>
    </main>
  );
}
