import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { reservedCents } from "@/lib/reservations";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const [txs, held] = await Promise.all([
    prisma.walletTx.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    reservedCents(auth.user.id),
  ]);
  return NextResponse.json({
    walletCents: auth.user.walletCents,
    reservedCents: held,                                 // bloqueado por reservas vivas
    availableCents: auth.user.walletCents - held,        // o que dá para gastar/reservar
    txs,
  });
}
