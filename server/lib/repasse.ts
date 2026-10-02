import { prisma } from "./prisma";
import { saldoAsaasCents, statusTransferencia, transferirPix } from "./asaas";

/**
 * Paga a parte de um participante (lavador, comissão, aluguel) via PIX.
 *
 * A ordem importa: o Repasse é criado ANTES de chamar o Asaas, e a
 * transferência é amarrada a ele. É isso que a validação de saque consulta
 * para autorizar — sem registro prévio, o saque é recusado, mesmo que
 * alguém esteja com a chave da API na mão.
 */
export async function pagarParticipante(
  userId: string,
  valorCents: number,
  descricao: string
): Promise<{ ok: true; repasseId: string } | { ok: false; erro: string }> {
  if (valorCents <= 0) return { ok: false, erro: "Valor precisa ser maior que zero." };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, erro: "Usuário não encontrado." };
  if (!user.pixChave || !user.pixTipo)
    return { ok: false, erro: `${user.name ?? "Este usuário"} ainda não cadastrou a chave PIX.` };

  // conferir o saldo antes evita uma transferência que o Asaas recusaria
  const saldo = await saldoAsaasCents().catch(() => null);
  if (saldo !== null && saldo < valorCents)
    return {
      ok: false,
      erro: `Saldo insuficiente na conta Asaas (disponível R$ ${(saldo / 100).toFixed(2).replace(".", ",")}).`,
    };

  const repasse = await prisma.repasse.create({
    data: { userId, valorCents, pixChave: user.pixChave, descricao },
  });

  try {
    const t = await transferirPix(
      user.pixChave,
      user.pixTipo,
      valorCents,
      descricao,
      repasse.id          // volta como externalReference, para auditoria
    );
    await prisma.repasse.update({
      where: { id: repasse.id },
      data: {
        asaasTransferId: t.id,
        // DONE aqui é raro: o normal é o Asaas processar e confirmar depois
        status: t.status === "DONE" ? "CONCLUIDO" : "PENDENTE",
        ...(t.status === "DONE" ? { concluidoEm: new Date() } : {}),
      },
    });
    return { ok: true, repasseId: repasse.id };
  } catch (e) {
    await prisma.repasse.update({ where: { id: repasse.id }, data: { status: "FALHOU" } });
    return { ok: false, erro: e instanceof Error ? e.message : "Falha ao transferir." };
  }
}

/**
 * Traz o status da transferência do Asaas para o Repasse. Chamado pelo
 * webhook (TRANSFER_DONE/FAILED/CANCELLED) e pela tela de repasses — a tela
 * garante o status certo mesmo que o evento do webhook não esteja ligado.
 * Repasse que FALHOU volta a contar como "a pagar".
 */
export async function sincronizarRepasse(repasseId: string): Promise<void> {
  const r = await prisma.repasse.findUnique({ where: { id: repasseId } });
  if (!r?.asaasTransferId || r.status === "CONCLUIDO" || r.status === "FALHOU") return;
  const status = await statusTransferencia(r.asaasTransferId);
  if (status === "DONE")
    await prisma.repasse.update({ where: { id: r.id }, data: { status: "CONCLUIDO", concluidoEm: new Date() } });
  else if (status === "FAILED" || status === "CANCELLED")
    await prisma.repasse.update({ where: { id: r.id }, data: { status: "FALHOU" } });
}

export type SaldoParticipante = {
  userId: string;
  nome: string;
  pixChave: string | null;
  pixTipo: string | null;
  vinculos: { maquina: string; tipo: string; percentual: number; parteCents: number }[];
  /** Parte dele em tudo que entrou pelo app (desde o início). */
  devidoCents: number;
  /** O que já foi pago a ele (sem contar repasse que falhou). */
  repassadoCents: number;
  aPagarCents: number;
};

/**
 * Quanto cada participante tem a receber do ADMIN.
 *
 * Pela regra de lib/comissao.ts, o dinheiro do app (carteira) fica com o
 * admin, que repassa a parte de cada um; o presencial fica com o lavador,
 * que acerta em espécie. Então aqui entra SÓ o app.
 *
 * É saldo corrido (tudo que já foi devido menos tudo que já foi pago), não
 * por período: assim um mês esquecido não some e nada é pago duas vezes.
 */
export async function saldosAPagar(): Promise<SaldoParticipante[]> {
  const [vinculos, receitaApp, pagos] = await Promise.all([
    prisma.machineParticipante.findMany({
      include: { user: true, machine: { include: { station: true } } },
    }),
    prisma.reservation.groupBy({
      by: ["machineId"],
      where: { status: "COMPLETED", machineId: { not: null } },
      _sum: { amountCents: true },
    }),
    prisma.repasse.groupBy({
      by: ["userId"],
      where: { status: { not: "FALHOU" } },
      _sum: { valorCents: true },
    }),
  ]);

  const appPorMaquina = new Map(receitaApp.map((r) => [r.machineId, r._sum.amountCents ?? 0]));
  const pagoPorUsuario = new Map(pagos.map((p) => [p.userId, p._sum.valorCents ?? 0]));
  const porUsuario = new Map<string, SaldoParticipante>();

  for (const v of vinculos) {
    const parteCents = Math.round(((appPorMaquina.get(v.machineId) ?? 0) * v.percentual) / 100);
    let s = porUsuario.get(v.userId);
    if (!s) {
      s = {
        userId: v.userId,
        nome: v.user.name ?? v.user.email ?? v.user.phone,
        pixChave: v.user.pixChave,
        pixTipo: v.user.pixTipo,
        vinculos: [],
        devidoCents: 0,
        repassadoCents: pagoPorUsuario.get(v.userId) ?? 0,
        aPagarCents: 0,
      };
      porUsuario.set(v.userId, s);
    }
    s.vinculos.push({
      maquina: `${v.machine.station.city} · Máquina ${v.machine.numero}`,
      tipo: v.tipo,
      percentual: v.percentual,
      parteCents,
    });
    s.devidoCents += parteCents;
  }

  for (const s of porUsuario.values()) s.aPagarCents = Math.max(0, s.devidoCents - s.repassadoCents);
  return [...porUsuario.values()].sort((a, b) => b.aPagarCents - a.aPagarCents);
}
