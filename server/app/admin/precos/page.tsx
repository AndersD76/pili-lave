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
        Os 4 tipos valem pra todas as unidades — nome e descrição são definidos aqui.
        O preço de cada tipo é preenchido dentro de cada unidade, em
        Máquinas, porque cada uma cobra o valor que quiser.
        <br />
        <b>Nome</b> fica curto (aparece do lado do preço). <b>Descrição</b> é o que está incluso
        no serviço — aparece embaixo do nome, pro cliente entender a diferença entre os tipos.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {programas.map((p) => (
          <form
            key={p.id}
            action={salvarNomeTipo}
            className="card"
            style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480 }}
          >
            <input type="hidden" name="id" value={p.id} />
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--aco-d)" }}>
              Nome (curto)
              <input
                className="field"
                style={{ width: "100%", height: 36, fontSize: 14, padding: "0 10px", marginTop: 4 }}
                name="nome"
                type="text"
                defaultValue={p.nome}
                maxLength={40}
                required
              />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--aco-d)" }}>
              Descrição (o que está incluso)
              <textarea
                className="field"
                style={{ width: "100%", minHeight: 60, fontSize: 14, padding: "8px 10px", marginTop: 4, resize: "vertical" }}
                name="descricao"
                defaultValue={p.descricao ?? ""}
                maxLength={200}
                placeholder="Ex: carroceria + rodas, sem cera"
              />
            </label>
            <button className="btn ghost" type="submit" style={{ height: 36, alignSelf: "flex-start" }}>Salvar</button>
          </form>
        ))}
      </div>
    </main>
  );
}
