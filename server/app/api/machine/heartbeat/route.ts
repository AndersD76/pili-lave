import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMachine } from "@/lib/device";
import { computeLight, pendingStart } from "@/lib/reservations";

const Body = z.object({
  state: z.enum(["FREE", "WASHING", "FAULT"]).optional(),
  restanteSeg: z.number().int().min(0).optional(),
});

/**
 * Batida do ESP32 da máquina (a cada ~10s). É por AQUI que a máquina recebe
 * a liberação do pagamento: a resposta traz `start` enquanto houver reserva
 * ACTIVE/ENTERED alocada (o firmware deduplica por reservationId em NVS).
 * Também devolve `lightState` — o ESP32 aciona a lâmpada bicolor por GPIO.
 * Modelo pull: sem porta aberta no dispositivo, funciona atrás de NAT/4G.
 */
export async function POST(req: NextRequest) {
  const auth = await requireMachine(req);
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const body = parsed.success ? parsed.data : {};

  // MAINTENANCE é decisão do admin — o heartbeat não a sobrescreve.
  // Sem `state` no corpo, só sai de OFFLINE (volta a FREE); estados
  // reportados (FREE/WASHING/FAULT) valem como fonte da verdade.
  const nextStatus =
    auth.machine.status === "MAINTENANCE"
      ? undefined
      : body.state ?? (auth.machine.status === "OFFLINE" ? "FREE" : undefined);
  const now = new Date();
  const machine = await prisma.machine.update({
    where: { id: auth.machine.id },
    data: {
      lastHeartbeat: now,
      lastHeartbeatSuccess: now,
      remainingSec: body.restanteSeg ?? 0,
      ...(nextStatus ? { status: nextStatus } : {}),
    },
  });

  const light = await computeLight(machine);
  const start = await pendingStart(machine);
  let startPayload: null | { reservationId: string; programId: number; duracaoSeg: number } = null;
  if (start) {
    const program = await prisma.program.findUnique({ where: { id: start.programId } });
    startPayload = {
      reservationId: start.id,
      programId: start.programId,
      duracaoSeg: (program?.duracaoMin ?? 30) * 60,
    };
  }

  const daysWithoutPayment = machine.lastPaymentDate
    ? Math.floor((now.getTime() - machine.lastPaymentDate.getTime()) / 86_400_000)
    : 0;

  return NextResponse.json({
    lightState: light,
    start: startPayload,
    license: {
      daysWithoutPayment,
      blocked: daysWithoutPayment >= 50,
    },
  });
}
