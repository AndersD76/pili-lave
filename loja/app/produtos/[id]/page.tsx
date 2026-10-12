import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ROTULO_MOVIMENTO, type TipoMovimento } from "@/lib/estoque";
import { exigirGestao } from "@/lib/sessao";
import { Nav } from "../../nav";
import { movimentarEstoque, salvarProduto } from "../actions";
import { CamposProduto } from "../CamposProduto";

export const dynamic = "force-dynamic";

function dataHora(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Um produto: cadastro, entrada manual, perda, contagem e o extrato do estoque. */
export default async function ProdutoDetalhe({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; ok?: string }>;
}) {
  const loja = await exigirGestao();
  const { id } = await params;
  const { erro, ok } = await searchParams;
  const produto = await prisma.produto.findUnique({
    where: { id },
    include: { movimentos: { orderBy: { criadoEm: "desc" }, take: 50 } },
  });
  if (!produto) notFound();

  return (
    <main className="admin-wrap">
      <Nav loja={loja} atual="/produtos" />
      <p><Link href="/produtos">← Produtos e estoque</Link></p>
      <h1 style={{ margin: "8px 0 4px" }}>{produto.nome}</h1>
      <p className="sub">
        Estoque atual:{" "}
        <span className={`chip ${produto.estoqueAtual <= 0 ? "err" : produto.estoqueAtual <= produto.estoqueMinimo ? "at" : "ok"}`}>
          {produto.estoqueAtual} {produto.unidade}
        </span>
      </p>
      {erro && <p className="err-msg" style={{ marginTop: 10 }}>{erro}</p>}
      {ok && <p className="ok-msg" style={{ marginTop: 10 }}>Salvo.</p>}

      <h2 className="section-title">Cadastro</h2>
      <form action={salvarProduto} className="card" style={{ display: "grid", gap: 12 }}>
        <input type="hidden" name="id" value={produto.id} />
        <CamposProduto produto={produto} />
        <label className="sub" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" name="ativo" defaultChecked={produto.ativo} />
          Produto ativo (desmarque para tirar de venda sem apagar o histórico)
        </label>
        <button className="btn" type="submit" style={{ justifySelf: "start" }}>Salvar</button>
      </form>

      <h2 className="section-title">Quantidade em estoque</h2>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <form action={movimentarEstoque} className="card" style={{ display: "grid", gap: 10 }}>
          <input type="hidden" name="id" value={produto.id} />
          <input type="hidden" name="tipo" value="ENTRADA" />
          <b>Dar entrada</b>
          <p className="sub">Chegou mercadoria: soma a quantidade ao estoque.</p>
          <label className="rotulo">
            Quantidade que chegou
            <input className="field" name="quantidade" inputMode="numeric" required />
          </label>
          <label className="rotulo">
            Custo unitário (R$) — opcional, atualiza o custo do produto
            <input className="field" name="custoUnit" inputMode="decimal" />
          </label>
          <label className="rotulo">
            Observação (opcional)
            <input className="field" name="nota" maxLength={120} placeholder="Ex.: compra no atacado" />
          </label>
          <button className="btn" type="submit" style={{ justifySelf: "start" }}>Dar entrada</button>
        </form>

        <form action={movimentarEstoque} className="card" style={{ display: "grid", gap: 10 }}>
          <input type="hidden" name="id" value={produto.id} />
          <input type="hidden" name="tipo" value="PERDA" />
          <b>Registrar perda</b>
          <p className="sub">Vencido, quebrado, furtado: baixa a quantidade informada.</p>
          <label className="rotulo">
            Quantidade perdida
            <input className="field" name="quantidade" inputMode="numeric" required />
          </label>
          <label className="rotulo">
            Motivo
            <input className="field" name="nota" maxLength={120} required />
          </label>
          <button className="btn ghost" type="submit" style={{ justifySelf: "start" }}>Registrar perda</button>
        </form>

        <form action={movimentarEstoque} className="card" style={{ display: "grid", gap: 10 }}>
          <input type="hidden" name="id" value={produto.id} />
          <input type="hidden" name="tipo" value="AJUSTE" />
          <b>Contagem de inventário</b>
          <p className="sub">Informe quanto há na prateleira; o sistema lança a diferença.</p>
          <label className="rotulo">
            Quantidade contada
            <input className="field" name="quantidade" inputMode="numeric" required />
          </label>
          <label className="rotulo">
            Observação (opcional)
            <input className="field" name="nota" maxLength={120} />
          </label>
          <button className="btn ghost" type="submit" style={{ justifySelf: "start" }}>Ajustar estoque</button>
        </form>
      </div>

      <h2 className="section-title">Extrato do estoque (últimos {produto.movimentos.length})</h2>
      {produto.movimentos.length === 0 ? (
        <p className="sub">Nenhum movimento ainda.</p>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Quando</th><th>Tipo</th><th>Quantidade</th><th>Saldo</th><th>Observação</th></tr></thead>
            <tbody>
              {produto.movimentos.map((m) => (
                <tr key={m.id}>
                  <td>{dataHora(m.criadoEm)}</td>
                  <td>{ROTULO_MOVIMENTO[m.tipo as TipoMovimento] ?? m.tipo}</td>
                  <td style={{ color: m.quantidade < 0 ? "var(--erro)" : "var(--ok)" }}>
                    {m.quantidade > 0 ? `+${m.quantidade}` : m.quantidade}
                  </td>
                  <td>{m.saldoApos}</td>
                  <td>{m.nota ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
