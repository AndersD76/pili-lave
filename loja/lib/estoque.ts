import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/** Tipos de movimento do estoque (campo Movimento.tipo). */
export const TIPOS_MOVIMENTO = ["ENTRADA", "VENDA", "PERDA", "AJUSTE"] as const;
export type TipoMovimento = (typeof TIPOS_MOVIMENTO)[number];

export const ROTULO_MOVIMENTO: Record<TipoMovimento, string> = {
  ENTRADA: "Entrada", VENDA: "Venda", PERDA: "Perda", AJUSTE: "Ajuste",
};

/**
 * ÚNICO caminho pra mudar o saldo de um produto: grava o Movimento e
 * atualiza o cache Produto.estoqueAtual na mesma transação. `quantidade`
 * é o delta (positivo soma, negativo baixa). Devolve o saldo novo.
 *
 * O saldo pode ficar negativo de propósito: se o totem vender um item que o
 * sistema achava zerado, a venda aconteceu de verdade — o certo é registrar
 * e deixar o furo aparecer, não recusar.
 */
export async function movimentar(
  tx: Prisma.TransactionClient,
  args: { produtoId: string; tipo: TipoMovimento; quantidade: number; nota?: string | null; refId?: string | null }
): Promise<number> {
  const produto = await tx.produto.update({
    where: { id: args.produtoId },
    data: { estoqueAtual: { increment: args.quantidade } },
  });
  await tx.movimento.create({
    data: {
      produtoId: args.produtoId, tipo: args.tipo, quantidade: args.quantidade,
      saldoApos: produto.estoqueAtual, nota: args.nota || null, refId: args.refId ?? null,
    },
  });
  return produto.estoqueAtual;
}

/** Baixa por venda — será chamada pelo totem (etapa 3). */
export function baixarVenda(produtoId: string, quantidade: number, vendaId?: string) {
  return prisma.$transaction((tx) =>
    movimentar(tx, { produtoId, tipo: "VENDA", quantidade: -Math.abs(quantidade), refId: vendaId })
  );
}

/** Perda (vencido, quebrado, furtado): baixa a quantidade informada. */
export function registrarPerda(produtoId: string, quantidade: number, nota: string) {
  return prisma.$transaction((tx) =>
    movimentar(tx, { produtoId, tipo: "PERDA", quantidade: -Math.abs(quantidade), nota })
  );
}

/** Ajuste de inventário: informa quanto foi CONTADO na prateleira; o
 *  movimento é a diferença pro saldo do sistema. Sem diferença, não grava. */
export function ajustarInventario(produtoId: string, contado: number, nota: string) {
  return prisma.$transaction(async (tx) => {
    const atual = (await tx.produto.findUniqueOrThrow({ where: { id: produtoId } })).estoqueAtual;
    if (contado === atual) return atual;
    return movimentar(tx, { produtoId, tipo: "AJUSTE", quantidade: contado - atual, nota });
  });
}

/** Produtos ativos no estoque mínimo ou abaixo dele — o alerta de compra. */
export async function produtosCriticos() {
  const ativos = await prisma.produto.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } });
  return ativos.filter((p) => p.estoqueAtual <= p.estoqueMinimo);
}
