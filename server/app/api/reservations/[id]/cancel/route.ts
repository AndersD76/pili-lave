import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

/**
 * Motorista cancela a reserva — permitido só ANTES do X14 (HELD/ACTIVE).
 * Não há estorno: o valor nunca foi debitado, só deixa de estar bloqueado.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;

  const upd = await prisma.reservation.updateMany({
    where: { id, userId: auth.user.id, status: { in: ["HELD", "ACTIVE"] } },
    data: { status: "CANCELED", machineId: null },
  });
  if (upd.count === 0) {
    const r = await prisma.reservation.findFirst({ where: { id, userId: auth.user.id } });
    if (!r) return NextResponse.json({ error: "Reserva não encontrada" }, { status: 404 });
    if (r.status === "ENTERED")
      return NextResponse.json({ error: "O carro já entrou na máquina — não dá mais para cancelar" }, { status: 409 });
    return NextResponse.json({ error: `Reserva já está ${r.status}` }, { status: 409 });
  }

  await prisma.event.create({
    data: { type: "reservation_canceled", payload: { reservationId: id, userId: auth.user.id } },
  });
  return NextResponse.json({ ok: true });
}
