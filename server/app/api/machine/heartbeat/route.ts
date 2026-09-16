import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMachine } from "@/lib/device";
import { computeLight, pendingStart } from "@/lib/reservations";

const Body = z.object({
  state: z.enum(["FREE", "WASHING", "FAULT"]).optional(),
  restanteSeg: z.number().int().min(0).optional(),
  /* Sensores de presença do carro (o display manda o nível ao vivo):
   *   x14 = carro entrando   ·   x15 = carro na posição de lavagem
   * Servem para a nuvem saber que a máquina está OCUPADA mesmo sem
   * reserva — carro que entrou sem pagar, ou teste manual do operador.
   * Opcionais: firmware antigo continua funcionando sem eles. */
  x14: z.boolean().optional(),
  x15: z.boolean().optional(),
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
  /* Carro sob a máquina (X14/X15) = ocupada, mesmo que o display ainda
   * reporte FREE — ele só diz WASHING depois que o ciclo começa. Sem isto
   * o app mostraria "máquina livre" com um carro parado lá dentro. */
  const now0 = new Date();
  const carroPresente = body.x14 === true || body.x15 === true;
  /* O X15 é instável (pisca 0/1 — o próprio firmware usa debounce). Guarda
   * DESDE QUANDO acusa carro: assim uma piscada não faz o app alternar
   * entre "ocupada" e "livre" na frente do cliente. */
  const jaAcusava = auth.machine.sensorX14 === true || auth.machine.sensorX15 === true;
  const sensorDesde = carroPresente
    ? (jaAcusava ? auth.machine.sensorDesde ?? now0 : now0)
    : null;
  /* Só marca ocupada depois de 15s acusando carro — uma piscada do X15 não
   * pode alternar o estado da máquina a cada batida. */
  const carroEstavel =
    carroPresente && !!sensorDesde && now0.getTime() - sensorDesde.getTime() >= 15_000;
  const nextStatus =
    auth.machine.status === "MAINTENANCE"
      ? undefined
      : body.state === "FAULT"
        ? "FAULT"
        : carroEstavel && body.state !== "WASHING"
          ? "WASHING"
          : body.state ?? (auth.machine.status === "OFFLINE" ? "FREE" : undefined);
  const now = now0;
  const machine = await prisma.machine.update({
    where: { id: auth.machine.id },
    data: {
      lastHeartbeat: now,
      lastHeartbeatSuccess: now,
      remainingSec: body.restanteSeg ?? 0,
      ...(body.x14 !== undefined ? { sensorX14: body.x14 } : {}),
      ...(body.x15 !== undefined ? { sensorX15: body.x15 } : {}),
      ...(body.x14 !== undefined || body.x15 !== undefined ? { sensorDesde } : {}),
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
