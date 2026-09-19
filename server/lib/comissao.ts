import { prisma } from "@/lib/prisma";

/**
 * Divisão de comissão por máquina — múltiplos participantes possíveis
 * (Lavador, Comissão 1, Comissão 2, Aluguel), cada um com seu percentual.
 * REGRA FIXA: a soma de todos os participantes cadastrados numa máquina
 * nunca passa de 100% — o admin fica com o que sobra até 100% (nunca
 * guardado no banco, sempre calculado).
 *
 * Quem já está com o dinheiro na mão:
 *  - Presencial (pago em espécie, botões X1-X6): o LAVADOR já fica com o
 *    dinheiro na hora — deve repassar a parte de todo mundo (inclusive o
 *    admin) na proporção do percentual de cada um.
 *  - App (pago pela carteira do cliente): o ADMIN já fica com o dinheiro —
 *    deve repassar a parte de todo mundo (inclusive o lavador) do mesmo jeito.
 *
 * Comissão 1/2 e Aluguel nunca ficam com dinheiro nenhum na mão — são
 * sempre credores dos dois lados (presencial via lavador, app via admin).
 */

export type ParticipacaoRow = { tipo: "LAVADOR" | "COMISSAO1" | "COMISSAO2" | "ALUGUEL"; userId: string; percentual: number };

export async function participacoesDaMaquina(machineId: string): Promise<ParticipacaoRow[]> {
  const rows = await prisma.machineParticipante.findMany({ where: { machineId } });
  return rows.map((r) => ({ tipo: r.tipo, userId: r.userId, percentual: r.percentual }));
}

/** Percentual do usuário numa máquina específica (0 se não tiver vínculo). */
export async function percentualDoUsuarioNaMaquina(machineId: string, userId: string): Promise<number> {
  const row = await prisma.machineParticipante.findFirst({ where: { machineId, userId } });
  return row?.percentual ?? 0;
}

/**
 * Relatório de uma máquina, no período dado, pro percentual de UM
 * participante — usado tanto pelo painel do lavador quanto pelo dos
 * outros participantes (comissão/aluguel), só muda de onde vem o %.
 * Cada coluna (presencial/app) já sai com a PARTE DELE, não o bruto —
 * só totalGeralCents continua bruto.
 */
export async function relatorioMaquinaPara(machineId: string, percentual: number, inicio: Date, fim: Date) {
  const [appPorPrograma, presencialPorPrograma] = await Promise.all([
    prisma.reservation.groupBy({
      by: ["programId"],
      where: { machineId, status: "COMPLETED", completedAt: { gte: inicio, lte: fim } },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.lavagemPresencial.groupBy({
      by: ["programId"],
      where: { machineId, completedAt: { gte: inicio, lte: fim } },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
  ]);

  const appMap = new Map(appPorPrograma.map((g) => [g.programId, g]));
  const presMap = new Map(presencialPorPrograma.map((g) => [g.programId, g]));

  let totalGeralCents = 0;
  let totalPresencialCents = 0;
  let totalAppCents = 0;
  const porTipo = [1, 2, 3, 4].map((programId) => {
    const app = appMap.get(programId);
    const pres = presMap.get(programId);
    const appCents = app?._sum.amountCents ?? 0;
    const presCents = pres?._sum.amountCents ?? 0;
    totalGeralCents += appCents + presCents;
    totalPresencialCents += presCents;
    totalAppCents += appCents;
    return {
      programId,
      app: { lavagens: app?._count._all ?? 0, valorCents: parte(appCents, percentual) },
      presencial: { lavagens: pres?._count._all ?? 0, valorCents: parte(presCents, percentual) },
    };
  });

  return {
    porTipo,
    totalGeralCents,
    suaParticipacaoCents: participacaoDe(percentual, totalPresencialCents, totalAppCents),
  };
}

/** Percentual do admin = o que sobra até 100% da soma de todo mundo cadastrado. */
export function percentualAdmin(participacoes: { percentual: number }[]): number {
  const soma = participacoes.reduce((s, p) => s + p.percentual, 0);
  return Math.max(0, 100 - soma);
}

function parte(cents: number, percentual: number): number {
  return Math.round((cents * percentual) / 100);
}

/**
 * Pra UM participante (percentual dele), quanto ele tem a receber no total
 * (presencial + app) — é isso que aparece pra ele no app (sem detalhe de
 * quem paga o quê, só o resultado).
 */
export function participacaoDe(percentual: number, totalPresencialCents: number, totalAppCents: number): number {
  return parte(totalPresencialCents, percentual) + parte(totalAppCents, percentual);
}

/**
 * Visão completa (só pro admin): pra cada participante (incluindo o
 * "ADMIN" calculado), quanto vem do presencial e quanto vem do app, e o
 * saldo de quem deve pagar quem. Só o Lavador (presencial) e o Admin
 * (app) começam com dinheiro em mãos; todo mundo mais é sempre credor.
 */
export function divisaoCompleta(
  participacoes: ParticipacaoRow[],
  totalPresencialCents: number,
  totalAppCents: number
) {
  const percAdmin = percentualAdmin(participacoes);
  const todos = [...participacoes, { tipo: "ADMIN" as const, userId: null, percentual: percAdmin }];

  const porParticipante = todos.map((p) => ({
    tipo: p.tipo,
    userId: p.userId,
    percentual: p.percentual,
    presencialCents: parte(totalPresencialCents, p.percentual),
    appCents: parte(totalAppCents, p.percentual),
  }));

  // Quem tem dinheiro em mãos vs quem tem direito: lavador já embolsou
  // 100% do presencial (deve repassar o resto); admin já embolsou 100%
  // do app (deve repassar o resto). Pra quem não é lavador nem admin, o
  // "a receber" é o presencialCents + appCents cheio (não tem nada em mãos).
  const acertoPorParticipante = porParticipante.map((p) => {
    if (p.tipo === "LAVADOR") {
      // tem em mãos totalPresencialCents, direito a p.presencialCents+p.appCents
      const emMaos = totalPresencialCents;
      const direito = p.presencialCents + p.appCents;
      return { ...p, saldoCents: direito - emMaos }; // negativo = deve repassar
    }
    if (p.tipo === "ADMIN") {
      const emMaos = totalAppCents;
      const direito = p.presencialCents + p.appCents;
      return { ...p, saldoCents: direito - emMaos };
    }
    return { ...p, saldoCents: p.presencialCents + p.appCents }; // sempre credor
  });

  return { percAdmin, porParticipante: acertoPorParticipante };
}
