import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/admin";
import { AdminNav } from "../nav";
import { salvarNomeTipo } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminPrecos() {
  await requireAdminPage();
  const programas = await prisma.program.findMany({ orderBy: { ordem: "asc" } });

  return (
    <main className="admin-wrap">
      <AdminNav />
      <h2 className="section-title" style={{ marginTop: 0 }}>Tipos de lavagem</h2>
      <p style={{ color: "var(--aco-d)", fontSize: 14, marginBottom: 20 }}>
        Os 4 tipos valem pra todas as unidades — só o nome é definido aqui.
        O preço de cada tipo é preenchido dentro de cada unidade, em
        Máquinas, porque cada uma cobra o valor que quiser.
      </p>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Nome do tipo de lavagem</th><th></th></tr>
          </thead>
          <tbody>
            {programas.map((p) => (
              <tr key={p.id}>
                <td>
                  <form action={salvarNomeTipo} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="hidden" name="id" value={p.id} />
                    <input
                      className="field"
                      style={{ width: 320, height: 36, fontSize: 14, padding: "0 10px" }}
                      name="nome"
                      type="text"
                      defaultValue={p.nome}
                      required
                    />
                    <button className="btn ghost" type="submit" style={{ height: 36 }}>Salvar</button>
                  </form>
                </td>
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
