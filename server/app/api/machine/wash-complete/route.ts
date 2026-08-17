import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMachine } from "@/lib/device";
import { DONE_GREEN_S } from "@/lib/reservations";

const Body = z.object({ reservationId: z.string().optional() });

function voucherCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(10), (b) => alphabet[b % 32]).join("");
}

/**
 * AUTO_CONCLUIDO: ciclo terminou com sucesso — ÚNICO PONTO DE DÉBITO.
 * Atômico: Reservation → COMPLETED, débito na carteira, Order(REDEEMED)
 * como histórico, WalletTx(WASH), máquina volta a FREE com verde de saída.
 * Idempotente: retransmissões do ESP32 não debitam duas vezes.
 */
export async function POST(req: NextRequest) {
  const auth = await requireMachine(req);
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const wanted = parsed.success ? parsed.data.reservationId : undefined;

  const reservation = await prisma.reservation.findFirst({
    where: {
      machineId: auth.machine.id,
      status: "ENTERED",
      ...(wanted ? { id: wanted } : {}),
    },
    orderBy: { enteredAt: "asc" },
  });

  if (!reservation) {
    // retransmissão de um complete já processado?
    const done = await prisma.reservation.findFirst({
      where: { machineId: auth.machine.id, status: "COMPLETED", ...(wanted ? { id: wanted } : {}) },
      orderBy: { completedAt: "desc" },
    });
    if (done) return NextResponse.json({ ok: true, reservationId: done.id, dedup: true });
    await prisma.event.create({
      data: { type: "wash_complete_orphan", payload: { machineId: auth.machine.id, reservationId: wanted ?? null } },
    });
    return NextResponse.json({ ok: true, orphan: true });
  }

  const result = await prisma.$transaction(async (tx) => {
    const upd = await tx.reservation.updateMany({
      where: { id: reservation.id, status: "ENTERED" }, // trava contra corrida
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    if (upd.count === 0) return null; // outra requisição concluiu primeiro

    const order = await tx.order.create({
      data: {
        userId: reservation.userId,
        vehicleId: reservation.vehicleId,
        programId: reservation.programId,
        amountCents: reservation.amountCents,
        status: "REDEEMED",
        voucherCode: voucherCode(),
        redeemedAt: new Date(),
      },
    });
    await tx.reservation.update({ where: { id: reservation.id }, data: { orderId: order.id } });

    // o valor estava garantido pela reserva desde a criação — débito direto
    await tx.user.update({
      where: { id: reservation.userId },
      data: { walletCents: { decrement: reservation.amountCents } },
    });
    await tx.walletTx.create({
      data: { userId: reservation.userId, amountCents: -reservation.amountCents, kind: "WASH", refId: order.id },
    });
    await tx.machine.update({
      where: { id: auth.machine.id },
      data: {
        status: "FREE",
        remainingSec: 0,
        lightState: "GREEN_SOLID", // "pode sair" por alguns segundos
        lightUntil: new Date(Date.now() + DONE_GREEN_S * 1000),
      },
    });
    await tx.event.create({
      data: {
        type: "wash_completed",
        payload: { reservationId: reservation.id, orderId: order.id, amountCents: reservation.amountCents },
      },
    });
    return order;
  });

  if (!result) return NextResponse.json({ ok: true, reservationId: reservation.id, dedup: true });
  return NextResponse.json({ ok: true, reservationId: reservation.id, orderId: result.id });
}
