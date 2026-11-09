import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/** Identifica a loja pelo header x-device-key — usado pelas rotas que o
 *  computador da loja chama (pagamento no caixa, hoje; provisionamento usa
 *  a senha de fábrica, não isso). null = computador desconhecido. */
export function lojaPorDeviceKey(req: NextRequest) {
  const deviceKey = req.headers.get("x-device-key");
  return deviceKey ? prisma.loja.findUnique({ where: { deviceKey } }) : Promise.resolve(null);
}

/** Bloqueio em vigor do cliente nesta loja (null = pode entrar). */
export function bloqueioAtivo(lojaId: string, userId: string) {
  return prisma.lojaBloqueio.findFirst({ where: { lojaId, userId, removidoEm: null } });
}

/** A loja, só se este usuário for o dono dela — toda rota /api/dono/* passa
 *  por aqui, pra um dono nunca mexer na loja de outro. */
export function lojaDoDono(lojaId: string, userId: string) {
  return prisma.loja.findFirst({ where: { id: lojaId, donoId: userId } });
}
