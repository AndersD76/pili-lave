import { reais } from "@/lib/dinheiro";
import { prisma } from "@/lib/prisma";
import { exigirLojista } from "@/lib/sessao";
import { Nav } from "../nav";

export const dynamic = "force-dynamic";

const ROTULO_FORMA: Record<string, string> = { SIMULADO: "Simulado (teste)", CARTEIRA: "Saldo do app", MAQUININHA: "Cartão" };

function dataHora(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Vendas fechadas no caixa — só o lojista vê. As últimas 100, com os itens. */
export default async function Vendas() {
  const { loja, usuario } = await exigirLojista();
  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);
  const [vendas, hoje] = await Promise.all([
    prisma.venda.findMany({ orderBy: { id: "desc" }, take: 100, include: { itens: true } }),
    prisma.venda.aggregate({ where: { criadaEm: { gte: inicioDoDia } }, _sum: { totalCents: true }, _count: true }),
  ]);

  return (
    <main className="admin-wrap">
      <Nav loja={loja} usuario={usuario} atual="/gestao/vendas" />
      <div className="stats">
        <div className="stat">
          <div className="lab">Vendas hoje</div>
          <div className="val">{hoje._count}</div>
        </div>
        <div className="stat">
          <div className="lab">Total vendido hoje</div>
          <div className="val">{reais(hoje._sum.totalCents ?? 0)}</div>
        </div>
      </div>

      <h2 className="section-title">Últimas vendas ({vendas.length})</h2>
      {vendas.length === 0 ? (
        <p className="sub">Nenhuma venda registrada.</p>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Nº</th><th>Quando</th><th>Itens</th><th>Pagamento</th><th>Total</th></tr></thead>
            <tbody>
              {vendas.map((v) => (
                <tr key={v.id}>
                  <td>{v.id}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{dataHora(v.criadaEm)}</td>
                  <td>{v.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(", ")}</td>
                  <td>
                    <span className={`chip ${v.forma === "SIMULADO" ? "at" : "ok"}`}>{ROTULO_FORMA[v.forma] ?? v.forma}</span>
                  </td>
                  <td>{reais(v.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
