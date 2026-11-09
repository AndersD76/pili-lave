import Link from "next/link";
import { notFound } from "next/navigation";
import { itensDoFornecedor, sugestaoDeCompra } from "@/lib/compras";
import { reais, reaisCampo } from "@/lib/dinheiro";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/sessao";
import { Nav } from "../../../nav";
import { definirPedidoMinimo, salvarMarcacoesFornecedor } from "../../actions";
import { ExportarPedido } from "../../ExportarPedido";

export const dynamic = "force-dynamic";

/** Tela de compra de UM fornecedor: os itens dele abaixo do mínimo (com
 *  sugestão de quantidade) e, abaixo, os demais itens dele (pode marcar
 *  mesmo sem estar baixo). Marcar aqui tira o item das telas dos outros
 *  fornecedores até a entrada chegar (ver lib/compras.ts). */
export default async function CompraFornecedor({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; ok?: string }>;
}) {
  const { loja, usuario } = await exigirPermissao("COMPRAS");
  const { id } = await params;
  const { erro, ok } = await searchParams;

  const fornecedor = await prisma.fornecedor.findUnique({ where: { id }, select: { id: true, nome: true, pedidoMinimoCents: true } });
  if (!fornecedor) notFound();

  const { abaixo, demais } = await itensDoFornecedor(id);
  const pendentesMarcados = [...abaixo, ...demais].filter((i) => i.quantidadeMarcada !== null);

  return (
    <main className="admin-wrap">
      <div className="nao-imprimir">
        <Nav loja={loja} usuario={usuario} atual="/gestao/compras" />
      </div>
      <p className="nao-imprimir"><Link href="/gestao/compras">← Compras</Link></p>
      <h1 style={{ margin: "8px 0 4px" }}>{fornecedor.nome}</h1>
      {erro && <p className="err-msg" style={{ marginTop: 10 }}>{erro}</p>}
      {ok && <p className="ok-msg" style={{ marginTop: 10 }}>Marcações salvas.</p>}

      <div className="nao-imprimir card" style={{ marginTop: 10, display: "inline-block" }}>
        <form action={definirPedidoMinimo} className="linha-form" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="fornecedorId" value={fornecedor.id} />
          <label className="rotulo" style={{ width: 160 }}>
            Pedido mínimo (R$)
            <input className="field" name="pedidoMinimo" inputMode="decimal" defaultValue={reaisCampo(fornecedor.pedidoMinimoCents ?? 0)} />
          </label>
          <button className="btn ghost" type="submit" style={{ height: 40 }}>Salvar</button>
        </form>
        <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>
          Quando a soma do que está pendente passar este valor, aparece o selo na lista de fornecedores. Deixe em branco pra não avisar.
        </p>
      </div>

      <form action={salvarMarcacoesFornecedor}>
        <input type="hidden" name="fornecedorId" value={fornecedor.id} />
        <input type="hidden" name="ids" value={[...abaixo, ...demais].map((i) => i.produtoId).join(",")} />

        <h2 className="section-title">Abaixo do mínimo ({abaixo.length})</h2>
        {abaixo.length === 0 ? (
          <p className="sub">Nenhum item deste fornecedor está abaixo do mínimo.</p>
        ) : (
          <TabelaItens itens={abaixo} />
        )}

        <h2 className="section-title">Demais itens de {fornecedor.nome} ({demais.length})</h2>
        {demais.length === 0 ? (
          <p className="sub">Nenhum outro item vinculado a este fornecedor.</p>
        ) : (
          <TabelaItens itens={demais} />
        )}

        {(abaixo.length > 0 || demais.length > 0) && (
          <div className="nao-imprimir" style={{ marginTop: 12 }}>
            <button className="btn" type="submit">Salvar pedido</button>
          </div>
        )}
      </form>

      <ExportarPedido
        titulo={fornecedor.nome}
        linhas={pendentesMarcados.map((i) => ({ nome: i.nome, quantidade: i.quantidadeMarcada!, unidade: i.unidade }))}
      />
    </main>
  );
}

function TabelaItens({ itens }: { itens: Awaited<ReturnType<typeof itensDoFornecedor>>["abaixo"] }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr><th>Comprar?</th><th>Produto</th><th>Estoque</th><th>Mínimo</th><th>Quantidade a comprar</th><th>Último custo</th></tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.produtoId}>
              <td>
                <input
                  type="checkbox" name={`sel_${i.produtoId}`} defaultChecked={i.quantidadeMarcada !== null}
                  aria-label={`Comprar ${i.nome}`} style={{ width: 20, height: 20 }}
                />
              </td>
              <td>{i.nome}</td>
              <td>
                <span className={`chip ${i.estoqueAtual <= 0 ? "err" : i.estoqueAtual <= i.estoqueMinimo ? "at" : "ok"}`}>
                  {i.estoqueAtual} {i.unidade}
                </span>
              </td>
              <td>{i.estoqueMinimo}</td>
              <td>
                <input
                  className="field" name={`qtd_${i.produtoId}`} inputMode="numeric"
                  defaultValue={i.quantidadeMarcada ?? sugestaoDeCompra(i.estoqueAtual, i.estoqueMinimo)}
                  aria-label={`Quantidade de ${i.nome}`}
                  style={{ width: 100, height: 36, fontSize: 14, padding: "0 10px" }}
                />
              </td>
              <td>{reais(i.custoCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
