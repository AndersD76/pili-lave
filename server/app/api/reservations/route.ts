import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { HOLD_TTL_MIN, expireStale, reservedCents } from "@/lib/reservations";

const Body = z.object({
  programId: z.number().int(),
  vehicleId: z.string(),
  stationId: z.string().optional(),
});

/**
 * Cria a reserva: SEGURA o valor (não debita), válida por 1h.
 * Se não usar, expira sozinha e o valor volta a ficar disponível — sem estorno.
 * Limite: 1 reserva viva por veículo (evita travar todo o saldo).
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Escolha o veículo e o tipo de lavagem" }, { status: 400 });

  await expireStale();

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: parsed.data.vehicleId, userId: auth.user.id },
  });
  if (!vehicle) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

  const program = await prisma.program.findFirst({
    where: { id: parsed.data.programId, ativo: true },
  });
  if (!program) return NextResponse.json({ error: "Tipo de lavagem indisponível" }, { status: 404 });

  const existing = await prisma.reservation.findFirst({
    where: { vehicleId: vehicle.id, status: { in: ["HELD", "ACTIVE", "ENTERED"] } },
  });
  if (existing)
    return NextResponse.json(
      { error: "Este veículo já tem uma reserva ativa", reservationId: existing.id },
      { status: 409 }
    );

  const held = await reservedCents(auth.user.id);
  const available = auth.user.walletCents - held;
  if (available < program.precoCents)
    return NextResponse.json(
      { error: "Saldo disponível insuficiente. Adicione saldo para reservar.", availableCents: available },
      { status: 402 }
    );

  const reservation = await prisma.reservation.create({
    data: {
      userId: auth.user.id,
      vehicleId: vehicle.id,
      stationId: parsed.data.stationId ?? null,
      programId: program.id,
      amountCents: program.precoCents,
      expiresAt: new Date(Date.now() + HOLD_TTL_MIN * 60_000),
    },
  });
  await prisma.event.create({
    data: {
      type: "reservation_created",
      payload: { reservationId: reservation.id, userId: auth.user.id, plate: vehicle.plate, programId: program.id },
    },
  });

  return NextResponse.json(
    { ok: true, reservation: { id: reservation.id, status: reservation.status, expiresAt: reservation.expiresAt } },
    { status: 201 }
  );
}

/** Lista as reservas do usuário (vivas primeiro, depois histórico recente). */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  await expireStale();

  const reservations = await prisma.reservation.findMany({
    where: { userId: auth.user.id },
    include: { program: true, vehicle: true, station: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ reservations });
}
