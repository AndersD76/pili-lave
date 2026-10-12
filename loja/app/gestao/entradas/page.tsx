import Link from "next/link";
import { reais } from "@/lib/dinheiro";
import { lerNfe } from "@/lib/nfe";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/sessao";
import { Nav } from "../nav";
import { descartarNota, enviarNota } from "./actions";

export const dynamic = "force-dynamic";

const ROTULO_ORIGEM: Record<string, string> = { XML: "Nota fiscal", PDF: "Nota fiscal (PDF)", MANUAL: "Manual" };

function dataHora(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Entrada de mercadoria: envia o XML da nota, confere e confirma. Também
 *  lista as últimas entradas (as de nota e as lançadas à mão no produto). */
export default async function Entradas({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { loja, usuario } = await exigirPermissao("ENTRADA");
  const { erro, ok } = await searchParams;
  const [semPreco, pendentes, entradas, usuarios] = await Promise.all([
    prisma.produto.findMany({ where: { ativo: true, precoCents: null }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    prisma.notaPendente.findMany({ orderBy: { criadaEm: "desc" } }),
    prisma.entrada.findMany({
      orderBy: { criadaEm: "desc" }, take: 50,
      include: { fornecedor: true, itens: { include: { produto: { select: { nome: true } } } } },
    }),
    prisma.usuario.findMany({ select: { id: true, nome: true } }),
  ]);
  const nomeDe = new Map(usuarios.map((u) => [u.id, u.nome]));

  return (
    <main className="admin-wrap">
      <Nav loja={loja} usuario={usuario} atual="/gestao/entradas" />
      {erro && <p className="err-msg" style={{ marginBottom: 14 }}>{erro}</p>}
      {ok && <p className="ok-msg" style={{ marginBottom: 14 }}>Nota lançada: o estoque foi atualizado.</p>}
      {/* produto criado por nota nasce sem preço e não vende até ter um:
          o caminho pra definir fica aqui, logo depois da entrada */}
      {semPreco.length > 0 && (
        <div className="card" style={{ marginBottom: 18, borderColor: "var(--atencao)" }}>
          <b>{semPreco.length === 1 ? "1 produto está sem preço de venda" : `${semPreco.length} produtos estão sem preço de venda`}</b>
          <p className="sub" style={{ margin: "4px 0 10px" }}>
            Eles não aparecem no caixa até ter preço. Clique em cada um, preencha &quot;Preço de venda&quot; e salve.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {semPreco.map((p) => (
              <Link key={p.id} href={`/gestao/produtos/${p.id}`} className="chip at" style={{ fontSize: 13, padding: "6px 12px" }}>
                {p.nome}
              </Link>
            ))}
          </div>
        </div>
      )}

      <h2 className="section-title" style={{ marginTop: 0 }}>Entrada por nota fiscal</h2>
      <form action={enviarNota} className="card" style={{ display: "grid", gap: 12, maxWidth: 640 }}>
        <p className="sub">
          Envie o arquivo <b>.xml</b> da nota fiscal do fornecedor. Você confere os itens antes de qualquer coisa
          entrar no estoque. O fornecedor é obrigado a fornecer o XML; o PDF não serve aqui.
        </p>
        <input className="field" type="file" name="arquivo" accept=".xml,text/xml,application/xml" required />
        <button className="btn" type="submit" style={{ justifySelf: "start" }}>Ler nota</button>
      </form>
      <p className="sub" style={{ marginTop: 10 }}>
        Compra sem nota? Abra o produto em Produtos e estoque e use &quot;Dar entrada&quot;.
      </p>

      {pendentes.length > 0 && (
        <>
          <h2 className="section-title">Notas aguardando conferência ({pendentes.length})</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {pendentes.map((p) => {
              const l = lerNfe(p.xml);
              return (
                <div key={p.id} className="card" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ flex: 1, minWidth: 220 }}>
                    {l.ok ? `NF ${l.nota.numero} · ${l.nota.fornecedor.nome} · ${reais(l.nota.totalCents)}` : "Nota ilegível"}
                    <span className="sub" style={{ display: "block" }}>
                      enviada em {dataHora(p.criadaEm)} por {nomeDe.get(p.usuarioId) ?? "—"}
                    </span>
                  </span>
                  <Link className="btn ghost" href={`/gestao/entradas/conferir/${p.id}`} style={{ display: "inline-flex", alignItems: "center" }}>
                    Conferir
                  </Link>
                  <form action={descartarNota}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="btn ghost" type="submit">Descartar</button>
                  </form>
                </div>
              );
            })}
          </div>
        </>
      )}

      <h2 className="section-title">Últimas entradas ({entradas.length})</h2>
      {entradas.length === 0 ? (
        <p className="sub">Nenhuma entrada registrada.</p>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Quando</th><th>Origem</th><th>Fornecedor / nota</th><th>Itens</th><th>Total</th><th>Quem</th></tr>
            </thead>
            <tbody>
              {entradas.map((e) => (
                <tr key={e.id} style={e.id === ok ? { background: "rgba(47, 191, 113, 0.08)" } : undefined}>
                  <td style={{ whiteSpace: "nowrap" }}>{dataHora(e.criadaEm)}</td>
                  <td>{ROTULO_ORIGEM[e.origem] ?? e.origem}</td>
                  <td>{e.fornecedor ? `${e.fornecedor.nome}${e.numeroNf ? ` · NF ${e.numeroNf}` : ""}` : "—"}</td>
                  <td>{e.itens.map((i) => `${i.quantidade}× ${i.produto.nome}`).join(", ")}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{reais(e.totalCents)}</td>
                  <td>{e.usuarioId ? (nomeDe.get(e.usuarioId) ?? "—") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
