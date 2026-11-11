import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/admin";
import { AdminNav } from "../nav";
import { divergenciasAtuais } from "@/lib/contadores";
import { escolherListaContadores } from "./actions";

export const dynamic = "force-dynamic";

function money(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}
const quando = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

type Origem = "App" | "Presencial" | "Sócio" | "Bônus";
type Linha = {
  chave: string; quando: Date; origem: Origem; cliente: string; placa: string; maquina: string;
  programa: string; valor: string; status: "AGUARDANDO" | "CONCLUIDA" | "CANCELADA"; detalhe: string;
};

/**
 * Lavagens de TODAS as origens: pelo app (compra paga com a carteira), presenciais (dinheiro nos botões da máquina), sócios (mensalistas) e
 * bônus (promoção). Antes esta tela só listava as compras do app/voucher e as presenciais não apareciam em lugar nenhum além do resumo da
 * máquina. Sócio e bônus ficam em LavagemPresencial com valor 0; o tipo está num Event "lavagem_tipo".
 */
export default async function AdminLavagens() {
  await requireAdminPage();
  const [orders, presenciais, tipos, appPorProg, presPorProg] = await Promise.all([
    prisma.order.findMany({
      include: { program: true, user: true, vehicle: true, redeemedBy: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.lavagemPresencial.findMany({
      include: { program: true, machine: { select: { name: true } } },
      orderBy: { completedAt: "desc" },
      take: 200,
    }),
    prisma.event.findMany({ where: { type: "lavagem_tipo" }, select: { payload: true } }),
    prisma.reservation.groupBy({ by: ["programId"], where: { status: "COMPLETED" }, _count: { _all: true } }),
    prisma.lavagemPresencial.groupBy({ by: ["programId"], _count: { _all: true } }),
  ]);
  const programas = await prisma.program.findMany({ orderBy: { id: "asc" }, select: { id: true, nome: true } });

  // Conferência com o display (referência): por máquina, o que difere. O admin escolhe qual lista vale (acerto).
  const maquinas = await prisma.machine.findMany({ select: { id: true, name: true } });
  const conferencias = (
    await Promise.all(maquinas.map(async (m) => ({ m, div: await divergenciasAtuais(m.id).catch(() => null) })))
  ).filter((x) => x.div);

  // tipo (sócio/bônus) de cada lavagem presencial e contagem por programa
  const tipoPorLavagem = new Map<string, string>();
  const sociosPorProg = new Map<number, number>();
  const bonusPorProg = new Map<number, number>();
  for (const e of tipos) {
    const p = (e.payload ?? {}) as { lavagemId?: string; tipo?: string; programId?: number };
    if (p.lavagemId && p.tipo) tipoPorLavagem.set(p.lavagemId, p.tipo);
    if (p.programId && p.tipo === "SOCIO") sociosPorProg.set(p.programId, (sociosPorProg.get(p.programId) ?? 0) + 1);
    if (p.programId && p.tipo === "BONUS") bonusPorProg.set(p.programId, (bonusPorProg.get(p.programId) ?? 0) + 1);
  }
  const app = new Map(appPorProg.map((g) => [g.programId, g._count._all]));
  const pres = new Map(presPorProg.map((g) => [g.programId, g._count._all]));
  const resumo = programas.map((pr) => {
    const so = sociosPorProg.get(pr.id) ?? 0, bo = bonusPorProg.get(pr.id) ?? 0;
    const presencial = Math.max(0, (pres.get(pr.id) ?? 0) - so - bo);   // sócio/bônus também ficam em LavagemPresencial
    const ap = app.get(pr.id) ?? 0;
    return { nome: pr.nome, presencial, app: ap, socios: so, bonus: bo, total: presencial + ap + so + bo };
  });
  const tot = resumo.reduce(
    (t, l) => ({ presencial: t.presencial + l.presencial, app: t.app + l.app, socios: t.socios + l.socios, bonus: t.bonus + l.bonus, total: t.total + l.total }),
    { presencial: 0, app: 0, socios: 0, bonus: 0, total: 0 }
  );

  const linhas: Linha[] = [
    ...orders.map((o): Linha => ({
      chave: "o" + o.id, quando: o.createdAt, origem: "App",
      cliente: o.user.name ?? o.user.phone, placa: o.vehicle?.plate ?? "—", maquina: "—",
      programa: o.program.nome, valor: money(o.amountCents),
      status: o.status === "PAID" ? "AGUARDANDO" : o.status === "REDEEMED" ? "CONCLUIDA" : "CANCELADA",
      detalhe: o.redeemedBy ? `resgatada por ${o.redeemedBy.name ?? o.redeemedBy.phone}` : o.voucherCode,
    })),
    ...presenciais.map((l): Linha => {
      const t = tipoPorLavagem.get(l.id);
      const origem: Origem = t === "SOCIO" ? "Sócio" : t === "BONUS" ? "Bônus" : "Presencial";
      return {
        chave: "p" + l.id, quando: l.completedAt, origem,
        cliente: origem === "Presencial" ? "Pago na máquina (dinheiro)" : origem === "Sócio" ? "Sócio (mensalista)" : "Bônus (promoção)",
        placa: "—", maquina: l.machine.name, programa: l.program.nome, valor: money(l.amountCents), status: "CONCLUIDA", detalhe: "",
      };
    }),
  ].sort((a, b) => b.quando.getTime() - a.quando.getTime()).slice(0, 300);

  const chipOrigem = (o: Origem) => (o === "App" ? "chip ok" : o === "Presencial" ? "chip at" : "chip");

  return (
    <main>
      <AdminNav />
      <h2 className="section-title">Lavagens — por origem</h2>

      {conferencias.map(({ m, div }) => (
        <div key={m.id} className="card" style={{ borderColor: "var(--atencao)", borderWidth: 2, marginBottom: 18 }}>
          <div className="lab" style={{ color: "var(--atencao)" }}>
            Contadores diferentes — {m.name} (desde {div!.desdeTxt})
          </div>
          <p style={{ margin: "6px 0 10px" }}>
            O display da máquina e a nuvem contam lavagens diferentes. Escolha qual lista vale — o display é a referência da máquina.
          </p>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Tipo</th><th>Modelo</th><th>Display</th><th>Nuvem</th><th>Diferença</th></tr></thead>
              <tbody>
                {div!.itens.map((d, i) => (
                  <tr key={i}>
                    <td>{d.grupo}</td><td>{d.modelo}</td><td>{d.display}</td><td>{d.nuvem}</td>
                    <td style={{ fontWeight: 700 }}>{d.display - d.nuvem > 0 ? "+" : ""}{d.display - d.nuvem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <form action={escolherListaContadores}>
              <input type="hidden" name="machineId" value={m.id} />
              <input type="hidden" name="fonte" value="display" />
              <button className="btn" type="submit">Usar a lista do display</button>
            </form>
            <form action={escolherListaContadores}>
              <input type="hidden" name="machineId" value={m.id} />
              <input type="hidden" name="fonte" value="nuvem" />
              <button className="btn ghost" type="submit">Manter a lista da nuvem</button>
            </form>
          </div>
          <p style={{ color: "var(--aco-d)", fontSize: 13, marginTop: 8 }}>
            <b>Usar o display:</b> o que o display tem a mais em presencial, sócios e bônus é registrado agora como lavagem (presencial ao preço atual; sócio e
            bônus com valor 0) e entra no fechamento. Diferenças no app, ou a nuvem ter mais que o display, ficam só como ajuste aceito — nada é apagado.
            <br />
            <b>Manter a nuvem:</b> o display continua com os números dele até o próximo acerto na máquina; o aviso é encerrado.
          </p>
        </div>
      ))}

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Tipo de lavagem</th><th>Presencial</th><th>App</th><th>Sócios</th><th>Bônus</th><th>Total</th></tr>
          </thead>
          <tbody>
            {resumo.map((l) => (
              <tr key={l.nome}>
                <td>{l.nome}</td><td>{l.presencial}</td><td>{l.app}</td><td>{l.socios}</td><td>{l.bonus}</td><td>{l.total}</td>
              </tr>
            ))}
            <tr>
              <td style={{ fontWeight: 700 }}>Total</td>
              <td style={{ fontWeight: 700 }}>{tot.presencial}</td><td style={{ fontWeight: 700 }}>{tot.app}</td>
              <td style={{ fontWeight: 700 }}>{tot.socios}</td><td style={{ fontWeight: 700 }}>{tot.bonus}</td><td style={{ fontWeight: 700 }}>{tot.total}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ color: "var(--aco-d)", fontSize: 13, margin: "6px 0 18px" }}>
        Lavagens concluídas desde que o sistema passou a registrá-las (as presenciais só aparecem aqui a partir de 02/11; o contador do display
        da máquina é de outra janela e pode ser maior).
      </p>

      <h3 className="section-title">Últimas 300 (todas as origens)</h3>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Quando</th><th>Origem</th><th>Cliente</th><th>Placa</th><th>Máquina</th><th>Programa</th><th>Valor</th><th>Status</th><th>Detalhe</th></tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave}>
                <td>{quando(l.quando)}</td>
                <td><span className={chipOrigem(l.origem)}>{l.origem}</span></td>
                <td>{l.cliente}</td>
                <td>{l.placa}</td>
                <td>{l.maquina}</td>
                <td>{l.programa}</td>
                <td>{l.valor}</td>
                <td>
                  {l.status === "AGUARDANDO" && <span className="chip at">Aguardando</span>}
                  {l.status === "CONCLUIDA" && <span className="chip ok">Concluída</span>}
                  {l.status === "CANCELADA" && <span className="chip err">Cancelada</span>}
                </td>
                <td style={{ color: "var(--aco-d)" }}>{l.detalhe}</td>
              </tr>
            ))}
            {linhas.length === 0 && <tr><td colSpan={9} style={{ color: "var(--aco-d)" }}>Sem lavagens ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
