import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/admin";
import { AdminNav } from "../nav";
import { definirPapel, aprovarSolicitacao, rejeitarSolicitacao } from "./actions";

export const dynamic = "force-dynamic";

function money(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

const LABEL_TIPO: Record<string, string> = {
  LAVADOR: "Lavador",
  COMISSAO1: "Comissão 1",
  COMISSAO2: "Comissão 2",
  ALUGUEL: "Aluguel",
};

export default async function AdminUsuarios() {
  await requireAdminPage();
  const [pendentes, users] = await Promise.all([
    prisma.solicitacaoParceiro.findMany({
      where: { status: "PENDENTE" },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      include: {
        _count: { select: { orders: true, vehicles: true } },
        solicitacoes: { where: { status: { in: ["PENDENTE", "APROVADA"] } } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  return (
    <main>
      <AdminNav />

      {pendentes.length > 0 && (
        <>
          <h2 className="section-title">Cadastros a aprovar ({pendentes.length})</h2>
          <p style={{ color: "var(--aco-d)", fontSize: 13, marginBottom: 14 }}>
            Pedidos pra virar Lavador, Comissão 1/2 ou Aluguel — a pessoa continua Cliente normal até você aprovar, e
            pode ter mais de um pedido ao mesmo tempo (ex: Lavador de uma máquina e Aluguel de outra). Só depois de
            aprovada ela aparece pra vincular numa máquina.
          </p>
          <div className="tbl-wrap" style={{ marginBottom: 30 }}>
            <table className="tbl">
              <thead>
                <tr><th>Telefone</th><th>Nome</th><th>Pediu para ser</th><th>Desde</th><th></th></tr>
              </thead>
              <tbody>
                {pendentes.map((s) => (
                  <tr key={s.id}>
                    <td>{s.user.phone}</td>
                    <td>{s.user.name ?? "—"}</td>
                    <td><span className="chip at">{LABEL_TIPO[s.tipo] ?? s.tipo}</span></td>
                    <td>{s.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <form action={aprovarSolicitacao}>
                        <input type="hidden" name="id" value={s.id} />
                        <button className="btn ghost" type="submit" style={{ height: 32, padding: "0 10px", fontSize: 12 }}>Aprovar</button>
                      </form>
                      <form action={rejeitarSolicitacao}>
                        <input type="hidden" name="id" value={s.id} />
                        <button className="btn ghost" type="submit" style={{ height: 32, padding: "0 10px", fontSize: 12 }}>Rejeitar</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

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
                  {u.solicitacoes
                    // aprovado como LAVADOR já é óbvio pelo chip de papel acima — só mostra
                    // aqui o que a etiqueta "Parceiro"/"Lavador" sozinha não diz
                    .filter((s) => !(s.status === "APROVADA" && s.tipo === "LAVADOR"))
                    .map((s) => (
                      <span key={s.id} className={"chip " + (s.status === "APROVADA" ? "ok" : "at")} style={{ marginLeft: 6 }}>
                        {s.status === "APROVADA" ? LABEL_TIPO[s.tipo] ?? s.tipo : `pediu ${LABEL_TIPO[s.tipo] ?? s.tipo}`}
                      </span>
                    ))}
                </td>
                <td>{money(u.walletCents)}</td>
                <td>{u._count.orders}</td>
                <td>{u._count.vehicles}</td>
                <td>{u.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td>
                  {u.role !== "ADMIN" && (() => {
                    const aprovadaParceiro = u.solicitacoes.find((s) => s.status === "APROVADA" && s.tipo !== "LAVADOR");
                    const valorAtual = u.role === "PARCEIRO" && aprovadaParceiro ? `PARCEIRO:${aprovadaParceiro.tipo}` : u.role;
                    return (
                      <form action={definirPapel} style={{ display: "flex", gap: 6 }}>
                        <input type="hidden" name="id" value={u.id} />
                        <select name="role" defaultValue={valorAtual} className="field" style={{ height: 32, fontSize: 13, padding: "0 8px" }}>
                          <option value="CLIENT">Cliente</option>
                          <option value="LAVADOR">Lavador</option>
                          <option value="PARCEIRO:COMISSAO1">Parceiro — Comissão 1</option>
                          <option value="PARCEIRO:COMISSAO2">Parceiro — Comissão 2</option>
                          <option value="PARCEIRO:ALUGUEL">Parceiro — Aluguel</option>
                        </select>
                        <button className="btn ghost" type="submit" style={{ height: 32, padding: "0 10px", fontSize: 12 }}>Salvar</button>
                      </form>
                    );
                  })()}
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
