import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const order = await prisma.order.findFirst({
    where: { id, userId: auth.user.id },
    // a reserva conta o que está acontecendo na máquina: HELD (esperando o
    // carro) -> ACTIVE (verde) -> ENTERED (lavando) -> COMPLETED | FAILED
    include: { program: true, vehicle: true, reservation: true },
  });
  if (!order) return NextResponse.json({ error: "Lavagem não encontrada" }, { status: 404 });

  const r = order.reservation;
  return NextResponse.json({
    ...order,
    lavagem: r ? { status: r.status, valorCents: r.amountCents, concluidaEm: r.completedAt } : null,
  });
}
