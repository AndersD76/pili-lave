import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

/** Dono desbloqueia o cliente. A linha continua no banco (removidoEm), pra
 *  ficar o histórico de quem já foi bloqueado. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;

  const bloqueio = await prisma.lojaBloqueio.findFirst({
    where: { id, removidoEm: null, loja: { donoId: auth.user.id } },
  });
  if (!bloqueio) return NextResponse.json({ error: "Bloqueio não encontrado" }, { status: 404 });

  await prisma.lojaBloqueio.update({ where: { id }, data: { removidoEm: new Date() } });
  await prisma.event.create({
    data: { type: "loja_desbloqueio", payload: { lojaId: bloqueio.lojaId, userId: bloqueio.userId, donoId: auth.user.id } },
  });
  return NextResponse.json({ ok: true });
}
