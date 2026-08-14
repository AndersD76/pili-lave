import { Topup } from "@prisma/client";
import { prisma } from "./prisma";

/** Credita uma recarga na carteira — idempotente (só transiciona PENDING→PAID). */
export async function creditTopup(topupId: string): Promise<Topup> {
  return prisma.$transaction(async (tx) => {
    const topup = await tx.topup.findUniqueOrThrow({ where: { id: topupId } });
    if (topup.status !== "PENDING") return topup; // já processada

    const updated = await tx.topup.update({
      where: { id: topupId, status: "PENDING" },
      data: { status: "PAID", paidAt: new Date() },
    });
    await tx.user.update({
      where: { id: topup.userId },
      data: { walletCents: { increment: topup.amountCents } },
    });
    await tx.walletTx.create({
      data: { userId: topup.userId, amountCents: topup.amountCents, kind: "TOPUP", refId: topup.id },
    });
    await tx.event.create({
      data: { type: "topup_paid", payload: { userId: topup.userId, amountCents: topup.amountCents } },
    });
    return updated;
  });
}
