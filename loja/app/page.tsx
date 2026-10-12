import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { reais } from "@/lib/dinheiro";
import { produtosCriticos } from "@/lib/estoque";
import { exigirGestao } from "@/lib/sessao";
import { Nav } from "./nav";

export const dynamic = "force-dynamic";

/** Painel: o que precisa de atenção agora — o que comprar (estoque no
 *  mínimo) e o que ainda não pode ser vendido (sem preço). */
export default async function Painel() {
  const loja = await exigirGestao();
  const [ativos, criticos, semPreco] = await Promise.all([
    prisma.produto.findMany({ where: { ativo: true }, select: { estoqueAtual: true, custoCents: true } }),
    produtosCriticos(),
    prisma.produto.findMany({ where: { ativo: true, precoCents: null }, orderBy: { nome: "asc" } }),
  ]);
  const valorEmEstoque = ativos.reduce((soma, p) => soma + Math.max(0, p.estoqueAtual) * p.custoCents, 0);

  return (
    <main className="admin-wrap">
      <Nav loja={loja} atual="/" />

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
        <div className="stat">
          <div className="lab">Valor em estoque</div>
          <div className="val">{reais(valorEmEstoque)}</div>
          <div className="sub">a preço de custo</div>
        </div>
      </div>

      <h2 className="section-title">Para comprar ({criticos.length})</h2>
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
                  <td><Link href={`/produtos/${p.id}`}>{p.nome}</Link></td>
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
            Produtos criados por uma nota de entrada nascem sem preço. Defina o preço para liberar a venda.
          </p>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Produto</th><th>Custo</th><th>Estoque</th></tr></thead>
              <tbody>
                {semPreco.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/produtos/${p.id}`}>{p.nome}</Link></td>
                    <td>{reais(p.custoCents)}</td>
                    <td>{p.estoqueAtual}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
