import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const arrival = await prisma.arrival.findFirst({
    where: { id, userId: auth.user.id },
    include: {
      vehicle: { select: { plate: true, defaultProgramId: true } },
      // a reserva é quem conta o que está acontecendo na máquina:
      // HELD (aguardando o carro) → ACTIVE (verde) → ENTERED (lavando)
      // → COMPLETED (fim do ciclo, já debitado)
      reservation: { include: { program: { select: { nome: true } } } },
    },
  });
  if (!arrival) return NextResponse.json({ error: "Chegada não encontrada" }, { status: 404 });

  const r = arrival.reservation;
  return NextResponse.json({
    ...arrival,
    lavagem: r
      ? {
          status: r.status,          // HELD | ACTIVE | ENTERED | COMPLETED | ...
          programa: r.program.nome,
          valorCents: r.amountCents,
          concluidaEm: r.completedAt,
        }
      : null,
  });
}
