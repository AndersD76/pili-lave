import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMachine } from "@/lib/device";

const Body = z.object({ reservationId: z.string().optional() });

/**
 * X14 disparou: o carro está FISICAMENTE dentro da máquina.
 * ACTIVE → ENTERED (a partir daqui o motorista não cancela mais).
 * X14 órfão (sem reserva ACTIVE) é anomalia: registra e não cobra nada.
 */
export async function POST(req: NextRequest) {
  const auth = await requireMachine(req);
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const wanted = parsed.success ? parsed.data.reservationId : undefined;

  const reservation = await prisma.reservation.findFirst({
    where: {
      machineId: auth.machine.id,
      status: "ENTERED", // idempotência: retransmissão do mesmo evento
      ...(wanted ? { id: wanted } : {}),
    },
  });
  if (reservation) return NextResponse.json({ ok: true, reservationId: reservation.id, dedup: true });

  // O display guarda o último reservationId na NVS e não o limpa ao fim do
  // ciclo: ele pode mandar uma reserva ANTIGA (já concluída ou apagada).
  // Por isso, se o id pedido não casa, vale a reserva ACTIVE da máquina —
  // é ela que a nuvem liberou e que o carro está de fato usando.
  const active =
    (await prisma.reservation.findFirst({
      where: { machineId: auth.machine.id, status: "ACTIVE", ...(wanted ? { id: wanted } : {}) },
      orderBy: { activeAt: "asc" },
    })) ??
    (wanted
      ? await prisma.reservation.findFirst({
          where: { machineId: auth.machine.id, status: "ACTIVE" },
          orderBy: { activeAt: "asc" },
        })
      : null);

  if (!active) {
    // objeto/animal/carro não autorizado — sem reserva, sem efeito financeiro
    await prisma.event.create({
      data: { type: "x14_orphan", payload: { machineId: auth.machine.id, reservationId: wanted ?? null } },
    });
    return NextResponse.json({ ok: true, orphan: true });
  }

  await prisma.$transaction(async (tx) => {
    await tx.reservation.update({
      where: { id: active.id },
      data: { status: "ENTERED", enteredAt: new Date() },
    });
    await tx.machine.update({
      where: { id: auth.machine.id },
      data: { status: "WASHING", lightState: "OFF", lightUntil: null }, // carro dentro: luz apaga
    });
    await tx.arrival.updateMany({
      where: { reservationId: active.id, status: { in: ["WAITING_DRIVER", "REQUESTED"] } },
      data: { status: "STARTED", startedAt: new Date() },
    });
    await tx.event.create({
      data: { type: "car_entered", payload: { reservationId: active.id, machineId: auth.machine.id } },
    });
  });

  return NextResponse.json({ ok: true, reservationId: active.id });
}
