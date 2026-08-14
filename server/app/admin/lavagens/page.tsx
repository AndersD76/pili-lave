import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/admin";
import { AdminNav } from "../nav";

export const dynamic = "force-dynamic";

function money(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

export default async function AdminLavagens() {
  await requireAdminPage();
  const orders = await prisma.order.findMany({
    include: { program: true, user: true, vehicle: true, redeemedBy: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <main>
      <AdminNav />
      <h2 className="section-title">Lavagens — últimas 200</h2>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Quando</th><th>Cliente</th><th>Placa</th><th>Programa</th><th>Valor</th><th>Status</th><th>Resgatada por</th><th>Voucher</th></tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>{o.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td>{o.user.name ?? o.user.phone}</td>
                <td>{o.vehicle?.plate ?? "—"}</td>
                <td>{o.program.nome}</td>
                <td>{money(o.amountCents)}</td>
                <td>
                  {o.status === "PAID" && <span className="chip at">Aguardando</span>}
                  {o.status === "REDEEMED" && <span className="chip ok">Liberada</span>}
                  {o.status === "CANCELED" && <span className="chip err">Cancelada</span>}
                </td>
                <td>{o.redeemedBy ? (o.redeemedBy.name ?? o.redeemedBy.phone) : "—"}</td>
                <td style={{ color: "var(--aco-d)" }}>{o.voucherCode}</td>
              </tr>
            ))}
            {orders.length === 0 && <tr><td colSpan={8} style={{ color: "var(--aco-d)" }}>Sem lavagens ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
