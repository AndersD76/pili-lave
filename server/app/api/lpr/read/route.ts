import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireDevice, ARRIVAL_TTL_MIN } from "@/lib/device";
import { isValidPlate, normalizePlate } from "@/lib/placa";

const Body = z.object({ plate: z.string().min(6).max(10) });

/**
 * Câmera LPR: "chegou um carro com esta placa".
 * Idempotente: leituras repetidas da mesma placa reaproveitam a chegada ativa.
 */
export async function POST(req: NextRequest) {
  const denied = requireDevice(req);
  if (denied) return denied;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "plate obrigatória" }, { status: 400 });
  const plate = normalizePlate(parsed.data.plate);
  if (!isValidPlate(plate)) return NextResponse.json({ error: "placa inválida", plate }, { status: 422 });

  const cutoff = new Date(Date.now() - ARRIVAL_TTL_MIN * 60_000);

  // expira chegadas antigas ainda aguardando
  await prisma.arrival.updateMany({
    where: { status: "WAITING_DRIVER", createdAt: { lt: cutoff } },
    data: { status: "EXPIRED" },
  });

  // reaproveita chegada ativa da mesma placa
  const active = await prisma.arrival.findFirst({
    where: { plate, status: { in: ["WAITING_DRIVER", "REQUESTED"] }, createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
  });
  if (active)
    return NextResponse.json({ arrivalId: active.id, status: active.status, dedup: true });

  const vehicle = await prisma.vehicle.findFirst({
    where: { plate },
    orderBy: { createdAt: "desc" },
    include: { user: true },
  });

  const arrival = await prisma.arrival.create({
    data: {
      plate,
      vehicleId: vehicle?.id ?? null,
      userId: vehicle?.userId ?? null,
      status: vehicle ? "WAITING_DRIVER" : "NO_MATCH",
    },
  });
  await prisma.event.create({
    data: { type: "lpr_read", payload: { plate, match: !!vehicle, arrivalId: arrival.id } },
  });

  const menor = await prisma.program.findFirst({
    where: { ativo: true }, orderBy: { precoCents: "asc" },
  });
  const saldoOk = !!vehicle && !!menor && vehicle.user.walletCents >= menor.precoCents;

  // Sinalização luminosa da máquina:
  //  sem cadastro       -> vermelha contínua
  //  cadastro sem saldo -> verde+vermelha piscando
  //  cadastro com saldo -> verde contínua
  const light = !vehicle ? "RED_SOLID" : saldoOk ? "GREEN_SOLID" : "RED_GREEN_BLINK";

  return NextResponse.json({
    arrivalId: arrival.id,
    status: arrival.status,          // WAITING_DRIVER | NO_MATCH
    match: !!vehicle,
    clientName: vehicle?.user.name ?? null,
    saldoOk,                          // tem saldo p/ pelo menos a lavagem mais barata
    light,                            // RED_SOLID | RED_GREEN_BLINK | GREEN_SOLID
  });
}
