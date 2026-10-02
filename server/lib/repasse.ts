import { prisma } from "./prisma";
import { saldoAsaasCents, transferirPix } from "./asaas";

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
      erro: `Saldo insuficiente na conta Asaas (disponível R$ ${(saldo / 100).toFixed(2)}).`,
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
