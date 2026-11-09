import { prisma } from "../prisma";
import type { Maquininha, ResultadoCobranca } from "./tipos";

/**
 * Driver de hoje, enquanto nenhuma maquininha está integrada: o operador
 * olha o visor dela mesmo e confirma na tela do caixa. `confirmarManual()`
 * é chamada só pela rota /api/caixa/cartao/confirmar-manual, que só existe
 * porque este driver é manual — um driver de verdade não teria essa rota
 * fazendo sentido (quem aprova é a própria máquina, não um clique).
 */
export const maquininhaManual: Maquininha = {
  nome: "Confirmação manual",
  confirmacaoManual: true,

  async iniciar(totalCents) {
    const op = await prisma.operacaoCartao.create({ data: { totalCents } });
    return { operacaoId: op.id };
  },

  async consultar(operacaoId) {
    const op = await prisma.operacaoCartao.findUnique({ where: { id: operacaoId } });
    if (!op) return { situacao: "RECUSADO", motivo: "Cobrança não encontrada." };
    if (op.situacao === "APROVADO") return { situacao: "APROVADO", referencia: op.referencia ?? undefined };
    if (op.situacao === "RECUSADO") return { situacao: "RECUSADO", motivo: op.motivo ?? "Recusado." };
    return { situacao: "AGUARDANDO" };
  },
};

export async function confirmarManual(operacaoId: string, aprovado: boolean): Promise<ResultadoCobranca> {
  const op = await prisma.operacaoCartao.update({
    where: { id: operacaoId },
    data: { situacao: aprovado ? "APROVADO" : "RECUSADO", motivo: aprovado ? null : "Recusado pelo operador", concluidaEm: new Date() },
  });
  return op.situacao === "APROVADO" ? { situacao: "APROVADO" } : { situacao: "RECUSADO", motivo: op.motivo ?? "Recusado." };
}
