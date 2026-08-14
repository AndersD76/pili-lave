import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/admin";
import { AdminNav } from "./nav";

export const dynamic = "force-dynamic";

function money(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

export default async function AdminDashboard() {
  await requireAdminPage();

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const d7 = new Date(Date.now() - 7 * 864e5);
  const d30 = new Date(Date.now() - 30 * 864e5);

  const [
    vendidasHoje, vendidas7, vendidas30,
    resgatadasHoje, resgatadas30,
    recargasHoje, recargas30,
    passivo, usuarios, veiculos,
    porPrograma, ultimas,
  ] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: hoje }, status: { not: "CANCELED" } } }),
    prisma.order.count({ where: { createdAt: { gte: d7 }, status: { not: "CANCELED" } } }),
    prisma.order.count({ where: { createdAt: { gte: d30 }, status: { not: "CANCELED" } } }),
    prisma.order.count({ where: { redeemedAt: { gte: hoje } } }),
    prisma.order.count({ where: { redeemedAt: { gte: d30 } } }),
    prisma.topup.aggregate({ _sum: { amountCents: true }, where: { status: "PAID", paidAt: { gte: hoje } } }),
    prisma.topup.aggregate({ _sum: { amountCents: true }, where: { status: "PAID", paidAt: { gte: d30 } } }),
    prisma.user.aggregate({ _sum: { walletCents: true } }),
    prisma.user.count(),
    prisma.vehicle.count(),
    prisma.order.groupBy({
      by: ["programId"],
      where: { createdAt: { gte: d30 }, status: { not: "CANCELED" } },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    prisma.order.findMany({
      include: { program: true, user: true, vehicle: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  const programas = await prisma.program.findMany({ orderBy: { ordem: "asc" } });
  const progNome = (id: number) => programas.find((p) => p.id === id)?.nome ?? `#${id}`;

  return (
    <main>
      <AdminNav />
      <div className="stats">
        <div className="stat"><div className="lab">Lavagens hoje</div><div className="val">{vendidasHoje}</div><div className="sub">{vendidas7} em 7 dias · {vendidas30} em 30</div></div>
        <div className="stat"><div className="lab">Resgates hoje</div><div className="val">{resgatadasHoje}</div><div className="sub">{resgatadas30} em 30 dias</div></div>
        <div className="stat"><div className="lab">Recargas hoje</div><div className="val">{money(recargasHoje._sum.amountCents ?? 0)}</div><div className="sub">{money(recargas30._sum.amountCents ?? 0)} em 30 dias</div></div>
        <div className="stat alerta"><div className="lab">Saldo em carteiras</div><div className="val">{money(passivo._sum.walletCents ?? 0)}</div><div className="sub">passivo — dinheiro dos clientes</div></div>
        <div className="stat"><div className="lab">Clientes</div><div className="val">{usuarios}</div><div className="sub">{veiculos} veículos</div></div>
      </div>

      <h2 className="section-title">Vendas por tipo — 30 dias</h2>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Programa</th><th>Lavagens</th><th>Receita</th></tr></thead>
          <tbody>
            {porPrograma.map((g) => (
              <tr key={g.programId}>
                <td>{g.programId} · {progNome(g.programId)}</td>
                <td>{g._count._all}</td>
                <td>{money(g._sum.amountCents ?? 0)}</td>
              </tr>
            ))}
            {porPrograma.length === 0 && <tr><td colSpan={3} style={{ color: "var(--aco-d)" }}>Sem vendas ainda.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">Últimas lavagens</h2>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Quando</th><th>Cliente</th><th>Placa</th><th>Programa</th><th>Valor</th><th>Status</th></tr></thead>
          <tbody>
            {ultimas.map((o) => (
              <tr key={o.id}>
                <td>{o.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td>{o.user.name ?? o.user.phone}</td>
                <td>{o.vehicle?.plate ?? "—"}</td>
                <td>{o.program.nome}</td>
                <td>{money(o.amountCents)}</td>
                <td>
                  {o.status === "PAID" && <span className="chip at">Aguardando resgate</span>}
                  {o.status === "REDEEMED" && <span className="chip ok">Liberada</span>}
                  {o.status === "CANCELED" && <span className="chip err">Cancelada</span>}
                </td>
              </tr>
            ))}
            {ultimas.length === 0 && <tr><td colSpan={6} style={{ color: "var(--aco-d)" }}>Nada por aqui ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
