import Link from "next/link";
import { itensDoFornecedor, sugestaoDeCompra } from "@/lib/compras";
import { reais } from "@/lib/dinheiro";
import { exigirPermissao } from "@/lib/sessao";
import { Nav } from "../../nav";
import { salvarMarcacoesFornecedor } from "../actions";
import { ExportarPedido } from "../ExportarPedido";

export const dynamic = "force-dynamic";

/** Igual à tela de um fornecedor, mas pros produtos que ainda não têm
 *  nenhum fornecedor vinculado (ver lib/fornecedores.ts pra vincular). */
export default async function CompraSemFornecedor({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; ok?: string }>;
}) {
  const { loja, usuario } = await exigirPermissao("COMPRAS");
  const { erro, ok } = await searchParams;
  const { abaixo, demais } = await itensDoFornecedor(null);
  const pendentesMarcados = [...abaixo, ...demais].filter((i) => i.quantidadeMarcada !== null);

  return (
    <main className="admin-wrap">
      <div className="nao-imprimir">
        <Nav loja={loja} usuario={usuario} atual="/gestao/compras" />
      </div>
      <p className="nao-imprimir"><Link href="/gestao/compras">← Compras</Link></p>
      <h1 style={{ margin: "8px 0 4px" }}>Sem fornecedor</h1>
      <p className="sub">
        Produtos sem nenhum fornecedor vinculado. Pra aparecerem na tela de um fornecedor, vincule na ficha do produto.
      </p>
      {erro && <p className="err-msg" style={{ marginTop: 10 }}>{erro}</p>}
      {ok && <p className="ok-msg" style={{ marginTop: 10 }}>Marcações salvas.</p>}

      <form action={salvarMarcacoesFornecedor}>
        <input type="hidden" name="ids" value={[...abaixo, ...demais].map((i) => i.produtoId).join(",")} />

        <h2 className="section-title">Abaixo do mínimo ({abaixo.length})</h2>
        {abaixo.length === 0 ? <p className="sub">Nenhum item sem fornecedor está abaixo do mínimo.</p> : <TabelaItens itens={abaixo} />}

        <h2 className="section-title">Demais itens sem fornecedor ({demais.length})</h2>
        {demais.length === 0 ? <p className="sub">Nenhum outro item sem fornecedor.</p> : <TabelaItens itens={demais} />}

        {(abaixo.length > 0 || demais.length > 0) && (
          <div className="nao-imprimir" style={{ marginTop: 12 }}>
            <button className="btn" type="submit">Salvar pedido</button>
          </div>
        )}
      </form>

      <ExportarPedido
        titulo="Sem fornecedor"
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
