import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/admin";
import { AdminNav } from "../nav";
import MaquinasTabs from "./MaquinasTabs";
import { divisaoCompleta, participacoesDaMaquina } from "@/lib/comissao";
import { ESTADOS_AUTO, MOTIVOS_RESET } from "@/lib/resets";

export const dynamic = "force-dynamic";

const TIPOS_PARTICIPACAO = ["LAVADOR", "COMISSAO1", "COMISSAO2", "ALUGUEL"] as const;

const LIC_AVISO_DIAS = 40;
const LIC_BLOQUEIO_DIAS = 50;
const HEARTBEAT_OFFLINE_S = 60;
const HISTORICO_LIMITE = 30;

function diasDesde(d: Date | null): number {
  if (!d) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function fmtQuando(d: Date | null): string {
  if (!d) return "nunca";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.floor(s / 60)}min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)}h`;
  return `há ${Math.floor(s / 86400)}d`;
}

function fmtData(d: Date): string {
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

function money(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

function licencaDe(lastPaymentDate: Date | null): { label: string; classe: "ok" | "at" | "off" | "err" } {
  if (!lastPaymentDate) return { label: "sem registro", classe: "off" };
  const dias = diasDesde(lastPaymentDate);
  if (dias >= LIC_BLOQUEIO_DIAS) return { label: `BLOQUEADA (${dias}d)`, classe: "err" };
  if (dias >= LIC_AVISO_DIAS) return { label: `aviso (${dias}d)`, classe: "at" };
  return { label: `em dia (${dias}d)`, classe: "ok" };
}

export default async function AdminMaquinas() {
  await requireAdminPage();
  const [machines, lavadores, participantesPossiveis] = await Promise.all([
    prisma.machine.findMany({
      include: { station: true, operador: true },
      orderBy: [{ station: { city: "asc" } }, { numero: "asc" }],
    }),
    prisma.user.findMany({
      where: { role: "LAVADOR" },
      select: { id: true, name: true, phone: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { role: { in: ["LAVADOR", "PARCEIRO"] } },
      select: { id: true, name: true, phone: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const participacoesPorMaquina = await Promise.all(machines.map((m) => participacoesDaMaquina(m.id, "LAVAGEM")));
  const participacoesAspiradorPorMaquina = await Promise.all(machines.map((m) => participacoesDaMaquina(m.id, "ASPIRADOR")));
  const userLabelMap = new Map(participantesPossiveis.map((u) => [u.id, u.name ?? u.phone]));

  const historicos = await Promise.all(
    machines.map((m) =>
      prisma.reservation.findMany({
        where: { machineId: m.id, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        take: HISTORICO_LIMITE,
        include: { user: true, program: true },
      })
    )
  );

  // Desde o último "Marcar pago hoje" (lastPaymentDate é o nosso ponto de
  // fechamento) — por máquina, e agrupado por programa pra alimentar a aba
  // de totais. Consulta separada (não o histórico limitado a 30) porque uma
  // máquina de muito movimento pode ter mais lavagens que isso desde o
  // último fechamento.
  const porProgramaPorMaquina = await Promise.all(
    machines.map((m) =>
      prisma.reservation.groupBy({
        by: ["programId"],
        where: { machineId: m.id, status: "COMPLETED", completedAt: { gte: m.lastPaymentDate ?? new Date(0) } },
        _sum: { amountCents: true },
        _count: { _all: true },
      })
    )
  );
  // Mesma janela (desde o último fechamento), mas do lado presencial — pra
  // alimentar a divisão admin/lavador por máquina (só faz sentido pra quem
  // já tem lavador designado).
  const presencialPorProgramaPorMaquina = await Promise.all(
    machines.map((m) =>
      prisma.lavagemPresencial.groupBy({
        by: ["programId"],
        where: { machineId: m.id, completedAt: { gte: m.lastPaymentDate ?? new Date(0) } },
        _sum: { amountCents: true },
        _count: { _all: true },
      })
    )
  );
  // Sócios e bônus (firmware de 2026-11-02): a lavagem fica em LavagemPresencial com valor 0 e o tipo num Event "lavagem_tipo".
  const tiposPorMaquina = await Promise.all(
    machines.map((m) =>
      prisma.event.findMany({
        where: { type: "lavagem_tipo", createdAt: { gte: m.lastPaymentDate ?? new Date(0) }, payload: { path: ["machineId"], equals: m.id } },
        select: { payload: true },
      })
    )
  );
  // Aspirador desde o último fechamento — sempre pago pela carteira (nunca
  // em espécie), por isso entra só do lado "app" na divisão por escopo.
  const vacuumPorMaquina = await Promise.all(
    machines.map((m) =>
      prisma.vacuumUse.aggregate({
        where: { machineId: m.id, status: "COMPLETED", completedAt: { gte: m.lastPaymentDate ?? new Date(0) } },
        _sum: { amountCents: true },
      })
    )
  );
  const programas = await prisma.program.findMany({ orderBy: { ordem: "asc" } });
  const nomePrograma = new Map(programas.map((p) => [p.id, p.nome]));

  const totalPorProgramaGlobal = new Map<number, { qtd: number; valorCents: number }>();
  let totalGeralCents = 0;
  const totalDesdeFechamentoPorMaquina = machines.map((m, i) => {
    let total = 0;
    for (const g of porProgramaPorMaquina[i]) {
      const valor = g._sum.amountCents ?? 0;
      total += valor;
      totalGeralCents += valor;
      const atual = totalPorProgramaGlobal.get(g.programId) ?? { qtd: 0, valorCents: 0 };
      atual.qtd += g._count._all;
      atual.valorCents += valor;
      totalPorProgramaGlobal.set(g.programId, atual);
    }
    return total;
  });

  const offlineCount = machines.filter(
    (m) => !m.lastHeartbeat || Date.now() - m.lastHeartbeat.getTime() > HEARTBEAT_OFFLINE_S * 1000
  ).length;
  const manutencaoCount = machines.filter((m) => m.status === "MAINTENANCE").length;
  const bloqueadasCount = machines.filter((m) => licencaDe(m.lastPaymentDate).classe === "err").length;

  const maquinasProps = machines.map((m, i) => {
    const offline = !m.lastHeartbeat || Date.now() - m.lastHeartbeat.getTime() > HEARTBEAT_OFFLINE_S * 1000;

    // Divisão entre todos os participantes cadastrados na máquina (lavador,
    // comissão 1/2, aluguel) + admin (o que sobra até 100%). Só relevante
    // quando há pelo menos um participante cadastrado.
    const participacoes = participacoesPorMaquina[i];
    let divisao: {
      participantes: ReturnType<typeof divisaoCompleta>["porParticipante"];
      totalPresencialCents: number;
      totalAppCents: number;
    } | null = null;
    if (participacoes.length > 0) {
      let totalPresencialCents = 0, totalAppCents = 0;
      for (const g of presencialPorProgramaPorMaquina[i]) totalPresencialCents += g._sum.amountCents ?? 0;
      for (const g of porProgramaPorMaquina[i]) totalAppCents += g._sum.amountCents ?? 0;
      const { porParticipante } = divisaoCompleta(participacoes, totalPresencialCents, totalAppCents);
      divisao = { participantes: porParticipante, totalPresencialCents, totalAppCents };
    }

    // Mesma divisão, só pro aspirador (percentuais do escopo ASPIRADOR) —
    // sempre "app" (carteira), nunca presencial.
    const participacoesAsp = participacoesAspiradorPorMaquina[i];
    let divisaoAspirador: {
      participantes: ReturnType<typeof divisaoCompleta>["porParticipante"];
      totalAppCents: number;
    } | null = null;
    if (participacoesAsp.length > 0) {
      const totalAppCents = vacuumPorMaquina[i]._sum.amountCents ?? 0;
      const { porParticipante } = divisaoCompleta(participacoesAsp, 0, totalAppCents);
      divisaoAspirador = { participantes: porParticipante, totalAppCents };
    }

    // RESUMO do fim da aba da máquina: lavagens por tipo x origem (presencial, app, sócios, bônus) e o relatório do lavador.
    const sociosPorProg = new Map<number, number>();
    const bonusPorProg = new Map<number, number>();
    for (const ev of tiposPorMaquina[i]) {
      const pl = (ev.payload ?? {}) as { programId?: number; tipo?: string };
      if (!pl.programId) continue;
      const alvo = pl.tipo === "SOCIO" ? sociosPorProg : pl.tipo === "BONUS" ? bonusPorProg : null;
      if (alvo) alvo.set(pl.programId, (alvo.get(pl.programId) ?? 0) + 1);
    }
    const appPorProg = new Map(porProgramaPorMaquina[i].map((g) => [g.programId, { qtd: g._count._all, cents: g._sum.amountCents ?? 0 }]));
    const presPorProg = new Map(presencialPorProgramaPorMaquina[i].map((g) => [g.programId, { qtd: g._count._all, cents: g._sum.amountCents ?? 0 }]));
    const linhasResumo = programas.map((pr) => {
      const pres = presPorProg.get(pr.id);
      const so = sociosPorProg.get(pr.id) ?? 0;
      const bo = bonusPorProg.get(pr.id) ?? 0;
      const presencial = Math.max(0, (pres?.qtd ?? 0) - so - bo); // sócio/bônus também ficam em LavagemPresencial
      const app = appPorProg.get(pr.id)?.qtd ?? 0;
      const cents = (pres?.cents ?? 0) + (appPorProg.get(pr.id)?.cents ?? 0);
      return { programa: pr.nome, presencial, app, socios: so, bonus: bo, total: presencial + app + so + bo, cents };
    });
    const totaisResumo = linhasResumo.reduce(
      (t, l) => ({ presencial: t.presencial + l.presencial, app: t.app + l.app, socios: t.socios + l.socios, bonus: t.bonus + l.bonus, total: t.total + l.total, cents: t.cents + l.cents }),
      { presencial: 0, app: 0, socios: 0, bonus: 0, total: 0, cents: 0 }
    );
    const lavadorDivisao = divisao?.participantes.find((p) => p.tipo === "LAVADOR");
    const resumo = {
      linhas: linhasResumo.map((l) => ({ ...l, valor: money(l.cents) })),
      totais: { ...totaisResumo, valor: money(totaisResumo.cents) },
      lavador: lavadorDivisao
        ? { nome: userLabelMap.get(lavadorDivisao.userId ?? "") ?? "—", saldoCents: lavadorDivisao.saldoCents, saldo: money(Math.abs(lavadorDivisao.saldoCents)) }
        : null,
    };

    return {
      id: m.id,
      numero: m.numero,
      stationId: m.stationId,
      unidade: `${m.station.city} — ${m.station.address}`,
      status: m.status,
      offline,
      emManutencao: m.status === "MAINTENANCE",
      ultimaBatida: fmtQuando(m.lastHeartbeat),
      sensores: `X14:${m.sensorX14 ? "1" : "0"} X15:${m.sensorX15 ? "1" : "0"} · ${m.remainingSec}s restante`,
      licenca: licencaDe(m.lastPaymentDate),
      operadorId: m.operadorId,
      vacuumEnabled: m.vacuumEnabled,
      vacuumPriceCents: m.vacuumPriceCents,
      vacuumDurationMin: m.vacuumDurationMin,
      valorDesdeFechamento: money(totalDesdeFechamentoPorMaquina[i]),
      resumo,
      participantes: TIPOS_PARTICIPACAO.map((tipo) => {
        const p = participacoesPorMaquina[i].find((x) => x.tipo === tipo);
        return { tipo, userId: p?.userId ?? "", percentual: p?.percentual ?? 0 };
      }),
      participantesAspirador: TIPOS_PARTICIPACAO.map((tipo) => {
        const p = participacoesAspiradorPorMaquina[i].find((x) => x.tipo === tipo);
        return { tipo, userId: p?.userId ?? "", percentual: p?.percentual ?? 0 };
      }),
      divisao: divisao && {
        totalPresencial: money(divisao.totalPresencialCents),
        totalApp: money(divisao.totalAppCents),
        participantes: divisao.participantes.map((p) => ({
          tipo: p.tipo,
          label: p.tipo === "ADMIN" ? "Admin" : userLabelMap.get(p.userId ?? "") ?? "—",
          percentual: p.percentual,
          presencial: money(p.presencialCents),
          app: money(p.appCents),
          saldoCents: p.saldoCents,
          saldo: money(Math.abs(p.saldoCents)),
        })),
      },
      divisaoAspirador: divisaoAspirador && {
        totalApp: money(divisaoAspirador.totalAppCents),
        participantes: divisaoAspirador.participantes.map((p) => ({
          tipo: p.tipo,
          label: p.tipo === "ADMIN" ? "Admin" : userLabelMap.get(p.userId ?? "") ?? "—",
          percentual: p.percentual,
          app: money(p.appCents),
          saldoCents: p.saldoCents,
          saldo: money(Math.abs(p.saldoCents)),
        })),
      },
      historico: historicos[i].map((r) => ({
        id: r.id,
        quando: r.completedAt ? fmtData(r.completedAt) : "—",
        programa: r.program.nome,
        valor: money(r.amountCents),
        cliente: r.user.name ?? r.user.phone,
      })),
    };
  });

  // Reinícios das placas (W1/W2) enviados pela máquina — últimos 30 dias, para o admin ver a saúde elétrica/de firmware.
  type PayloadReset = {
    machineId?: string; quem?: string; motivo?: number; motivoNome?: string; estado?: number | null; estadoNome?: string | null;
    emCiclo?: boolean; upAntSeg?: number | null; total?: number | null; deliberado?: number; quandoReset?: string | null;
  };
  const reiniciosBrutos = await prisma.event.findMany({
    where: { type: "machine_reset", createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const reinicios = reiniciosBrutos.map((e) => {
    const p = (e.payload ?? {}) as PayloadReset;
    return { at: p.quandoReset ? new Date(p.quandoReset) : e.createdAt, p };
  });
  const nomeMaquina = new Map(machines.map((m) => [m.id, `${m.station.city} — máq. ${m.numero}`]));
  const resetsW1 = reinicios.filter((r) => r.p.quem === "W1").length;
  const resetsW2 = reinicios.filter((r) => r.p.quem === "W2").length;
  const resetsEmCiclo = reinicios.filter((r) => r.p.emCiclo).length;

  const lavadoresProps = lavadores.map((l) => ({ id: l.id, label: l.name ?? l.phone }));
  const participantesPossiveisProps = participantesPossiveis.map((u) => ({ id: u.id, label: u.name ?? u.phone }));

  // Preço por unidade — override (StationPrograma) quando existir, senão o
  // padrão do Program. Uma consulta só de overrides, indexada por unidade.
  const stationIds = Array.from(new Set(machines.map((m) => m.stationId)));
  const overrides = await prisma.stationPrograma.findMany({ where: { stationId: { in: stationIds } } });
  const overrideMap = new Map(overrides.map((o) => [`${o.stationId}:${o.programId}`, o.precoCents]));
  const precosPorUnidadeProps: Record<string, { programId: number; nome: string; precoCents: number; proprio: boolean }[]> = {};
  for (const stationId of stationIds) {
    precosPorUnidadeProps[stationId] = programas.map((p) => {
      const key = `${stationId}:${p.id}`;
      const proprio = overrideMap.has(key);
      return { programId: p.id, nome: p.nome, precoCents: proprio ? overrideMap.get(key)! : p.precoCents, proprio };
    });
  }

  const totaisProps = {
    valorTotalGeral: money(totalGeralCents),
    porPrograma: Array.from(totalPorProgramaGlobal.entries())
      .map(([programId, v]) => ({ programa: nomePrograma.get(programId) ?? `#${programId}`, qtd: v.qtd, valor: money(v.valorCents) }))
      .sort((a, b) => b.qtd - a.qtd),
  };

  return (
    <main className="admin-wrap">
      <AdminNav />
      <h2 className="section-title" style={{ marginTop: 0 }}>Máquinas</h2>

      <div className="stats">
        <div className="stat">
          <div className="lab">Total de máquinas</div>
          <div className="val">{machines.length}</div>
        </div>
        <div className={"stat" + (offlineCount > 0 ? " alerta" : "")}>
          <div className="lab">Offline agora</div>
          <div className="val">{offlineCount}</div>
        </div>
        <div className={"stat" + (manutencaoCount > 0 ? " alerta" : "")}>
          <div className="lab">Em manutenção</div>
          <div className="val">{manutencaoCount}</div>
        </div>
        <div className={"stat" + (bloqueadasCount > 0 ? " alerta" : "")}>
          <div className="lab">Licença bloqueada</div>
          <div className="val">{bloqueadasCount}</div>
        </div>
      </div>

      <div style={{ marginTop: 30 }}>
        <MaquinasTabs
          maquinas={maquinasProps}
          lavadores={lavadoresProps}
          participantesPossiveis={participantesPossiveisProps}
          totais={totaisProps}
          precosPorUnidade={precosPorUnidadeProps}
        />
      </div>

      <h2 className="section-title" style={{ marginTop: 40 }}>Reinícios das placas (30 dias)</h2>
      <div className="stats">
        <div className="stat">
          <div className="lab">W1 (controladora)</div>
          <div className="val">{resetsW1}</div>
        </div>
        <div className="stat">
          <div className="lab">W2 (entradas/saídas)</div>
          <div className="val">{resetsW2}</div>
        </div>
        <div className={"stat" + (resetsEmCiclo > 0 ? " alerta" : "")}>
          <div className="lab">No meio de uma lavagem</div>
          <div className="val">{resetsEmCiclo}</div>
        </div>
      </div>
      <p style={{ opacity: 0.7, fontSize: 13, margin: "12px 0" }}>
        A hora é a do reinício (relógio da máquina, ajustado pela internet); se a máquina ainda estava sem relógio, é a hora de chegada na nuvem. &quot;Energia ligada&quot; é a máquina religada, por exemplo depois do botão de emergência.
      </p>
      {reinicios.length === 0 ? (
        <p style={{ opacity: 0.7 }}>Nenhum reinício registrado nos últimos 30 dias.</p>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Máquina</th>
                <th>Placa</th>
                <th>Motivo</th>
                <th>Estado antes</th>
                <th>Ligada antes</th>
                <th>Total da placa</th>
              </tr>
            </thead>
            <tbody>
              {reinicios.slice(0, 40).map((r, i) => (
                <tr key={i}>
                  <td>{fmtData(r.at)}</td>
                  <td>{nomeMaquina.get(r.p.machineId ?? "") ?? "—"}</td>
                  <td>{r.p.quem ?? "—"}</td>
                  <td>
                    {r.p.deliberado === 1 ? "reiniciada de propósito (memória baixa)"
                      : r.p.deliberado === 2 ? "reiniciada de propósito (rádio travado)"
                      : r.p.motivoNome ?? MOTIVOS_RESET[r.p.motivo ?? -1] ?? "—"}
                  </td>
                  <td style={r.p.emCiclo ? { color: "var(--erro, #e5484d)", fontWeight: 600 } : undefined}>
                    {r.p.estadoNome ?? (r.p.estado != null ? ESTADOS_AUTO[r.p.estado] : null) ?? "desconhecido"}
                    {r.p.emCiclo ? " (ciclo interrompido)" : ""}
                  </td>
                  <td>{r.p.upAntSeg ? `${Math.floor(r.p.upAntSeg / 60)} min` : "—"}</td>
                  <td>{r.p.total ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
