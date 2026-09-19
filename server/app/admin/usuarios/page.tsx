import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isAdmin, requireAdminPage } from "@/lib/admin";
import { AdminNav } from "../nav";

export const dynamic = "force-dynamic";

function money(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

const PAPEIS_ATRIBUIVEIS = ["CLIENT", "LAVADOR", "PARCEIRO"] as const;

async function definirPapel(formData: FormData) {
  "use server";
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  const role = String(formData.get("role"));
  if (!PAPEIS_ATRIBUIVEIS.includes(role as (typeof PAPEIS_ATRIBUIVEIS)[number])) return;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role === "ADMIN") return;
  await prisma.user.update({ where: { id }, data: { role: role as (typeof PAPEIS_ATRIBUIVEIS)[number] } });
  revalidatePath("/admin/usuarios");
}

export default async function AdminUsuarios() {
  await requireAdminPage();
  const users = await prisma.user.findMany({
    include: { _count: { select: { orders: true, vehicles: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <main>
      <AdminNav />
      <h2 className="section-title">Usuários — promova um telefone a Lavador para ele poder escanear vouchers</h2>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Telefone</th><th>Nome</th><th>Papel</th><th>Saldo</th><th>Lavagens</th><th>Veículos</th><th>Desde</th><th></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.phone}</td>
                <td>{u.name ?? "—"}</td>
                <td>
                  {u.role === "ADMIN" && <span className="chip err">Admin</span>}
                  {u.role === "LAVADOR" && <span className="chip ok">Lavador</span>}
                  {u.role === "PARCEIRO" && <span className="chip at">Parceiro</span>}
                  {u.role === "CLIENT" && <span className="chip off">Cliente</span>}
                </td>
                <td>{money(u.walletCents)}</td>
                <td>{u._count.orders}</td>
                <td>{u._count.vehicles}</td>
                <td>{u.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td>
                  {u.role !== "ADMIN" && (
                    <form action={definirPapel} style={{ display: "flex", gap: 6 }}>
                      <input type="hidden" name="id" value={u.id} />
                      <select name="role" defaultValue={u.role} className="field" style={{ height: 32, fontSize: 13, padding: "0 8px" }}>
                        <option value="CLIENT">Cliente</option>
                        <option value="LAVADOR">Lavador</option>
                        <option value="PARCEIRO">Parceiro</option>
                      </select>
                      <button className="btn ghost" type="submit" style={{ height: 32, padding: "0 10px", fontSize: 12 }}>Salvar</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={8} style={{ color: "var(--aco-d)" }}>Nenhum usuário ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
