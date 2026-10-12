import { prisma } from "@/lib/prisma";

/** Bloqueio em vigor do cliente nesta loja (null = pode entrar). */
export function bloqueioAtivo(lojaId: string, userId: string) {
  return prisma.lojaBloqueio.findFirst({ where: { lojaId, userId, removidoEm: null } });
}

/** A loja, só se este usuário for o dono dela — toda rota /api/dono/* passa
 *  por aqui, pra um dono nunca mexer na loja de outro. */
export function lojaDoDono(lojaId: string, userId: string) {
  return prisma.loja.findFirst({ where: { id: lojaId, donoId: userId } });
}
