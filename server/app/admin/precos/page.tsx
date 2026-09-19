import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/admin";
import { AdminNav } from "../nav";
import { salvarPrecoPadrao } from "./actions";

export const dynamic = "force-dynamic";

function money(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export default async function AdminPrecos() {
  await requireAdminPage();
  const programas = await prisma.program.findMany({ orderBy: { ordem: "asc" } });
  const unidadesComPrecoProprio = await prisma.stationPrograma.groupBy({
    by: ["stationId"],
    _count: { _all: true },
  });

  return (
    <main className="admin-wrap">
      <AdminNav />
      <h2 className="section-title" style={{ marginTop: 0 }}>Preços — modelo padrão</h2>
      <p style={{ color: "var(--aco-d)", fontSize: 14, marginBottom: 20 }}>
        Esse é o preço que toda unidade nova usa pra cada tipo de lavagem. Uma
        unidade pode ter preço próprio (na aba dela, em Máquinas) — nesse
        caso ela ignora o valor daqui só pra ela mesma.
        {unidadesComPrecoProprio.length > 0 && (
          <> {unidadesComPrecoProprio.length} unidade(s) já têm preço próprio cadastrado.</>
        )}
      </p>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Tipo de lavagem</th><th>Preço padrão (R$)</th><th></th></tr>
          </thead>
          <tbody>
            {programas.map((p) => (
              <tr key={p.id}>
                <td>{p.nome}</td>
                <td>
                  <form action={salvarPrecoPadrao} style={{ display: "flex", gap: 8, alignItems: "center" }} id={`f${p.id}`}>
                    <input type="hidden" name="id" value={p.id} />
                    <input
                      className="field"
                      style={{ width: 120, height: 36, fontSize: 14, padding: "0 10px" }}
                      name="preco"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={money(p.precoCents)}
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
