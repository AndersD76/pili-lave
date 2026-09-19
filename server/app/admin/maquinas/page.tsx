import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/admin";
import { AdminNav } from "../nav";
import MaquinasTabs from "./MaquinasTabs";
import { divisaoCompleta, participacoesDaMaquina } from "@/lib/comissao";

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
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
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

  const participacoesPorMaquina = await Promise.all(machines.map((m) => participacoesDaMaquina(m.id)));
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
      valorDesdeFechamento: money(totalDesdeFechamentoPorMaquina[i]),
      participantes: TIPOS_PARTICIPACAO.map((tipo) => {
        const p = participacoesPorMaquina[i].find((x) => x.tipo === tipo);
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
      historico: historicos[i].map((r) => ({
        id: r.id,
        quando: r.completedAt ? fmtData(r.completedAt) : "—",
        programa: r.program.nome,
        valor: money(r.amountCents),
        cliente: r.user.name ?? r.user.phone,
      })),
    };
  });

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
    </main>
  );
}
