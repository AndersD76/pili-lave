import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getChargeStatus } from "@/lib/asaas";
import { creditTopup } from "@/lib/wallet";

/** Consulta o status da recarga; confirma via Asaas se o webhook ainda não chegou. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;

  let topup = await prisma.topup.findFirst({ where: { id, userId: auth.user.id } });
  if (!topup) return NextResponse.json({ error: "Recarga não encontrada" }, { status: 404 });

  if (topup.status === "PENDING" && topup.asaasPaymentId) {
    const status = await getChargeStatus(topup.asaasPaymentId).catch(() => "PENDING" as const);
    if (status === "PAID") topup = await creditTopup(topup.id);
  }
  return NextResponse.json({ id: topup.id, status: topup.status, walletCents: (await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } })).walletCents });
}
