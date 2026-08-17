import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMachine } from "@/lib/device";

const Body = z.object({
  errorCode: z.string().max(64).optional(),
  reservationId: z.string().optional(),
});

/**
 * AUTO_ERRO: a máquina falhou. Reserva em andamento vira FAILED — o saldo
 * volta a ficar disponível (nunca foi debitado), o motorista não paga nada
 * e o admin é alertado. A lâmpada fica em vermelho piscando até resolver.
 */
export async function POST(req: NextRequest) {
  const auth = await requireMachine(req);
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const body = parsed.success ? parsed.data : {};

  const affected = await prisma.reservation.updateMany({
    where: {
      machineId: auth.machine.id,
      status: { in: ["ACTIVE", "ENTERED"] },
      ...(body.reservationId ? { id: body.reservationId } : {}),
    },
    data: { status: "FAILED" },
  });

  await prisma.machine.update({
    where: { id: auth.machine.id },
    data: { status: "FAULT", remainingSec: 0, lightState: "RED_BLINK", lightUntil: null },
  });
  await prisma.event.create({
    data: {
      type: "machine_fault",
      payload: {
        machineId: auth.machine.id,
        errorCode: body.errorCode ?? null,
        failedReservations: affected.count,
      },
    },
  });

  return NextResponse.json({ ok: true, failedReservations: affected.count });
}
