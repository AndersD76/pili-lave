import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ARRIVAL_TTL_MIN } from "@/lib/device";
import { HOLD_TTL_MIN, defaultMachine } from "@/lib/reservations";

const Body = z.object({ programId: z.number().int() });

function voucherCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(10), (b) => alphabet[b % 32]).join("");
}

/**
 * Pagamento da lavagem no app: debita o saldo, cria o pedido e ABRE A
 * RESERVA (HELD). A reserva é obrigatória — é ela que o heartbeat da
 * máquina lê (pendingStart busca ACTIVE/ENTERED) para mandar o `start` ao
 * display; sem ela o cliente pagava e a máquina nunca ligava.
 *
 * Fluxo: paga -> reserva (HELD) -> carro chega -> a CÂMERA lê a placa ->
 * handlePlateRead promove HELD -> ACTIVE, acende o verde e o heartbeat
 * seguinte manda o `start`. Pagar NÃO libera a máquina.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Escolha o tipo de lavagem" }, { status: 400 });

  const arrival = await prisma.arrival.findFirst({
    where: { id, userId: auth.user.id },
    include: { vehicle: true },
  });
  if (!arrival) return NextResponse.json({ error: "Chegada não encontrada" }, { status: 404 });
  if (arrival.status === "REQUESTED" || arrival.status === "STARTED")
    return NextResponse.json({ error: "Lavagem já solicitada para este carro" }, { status: 409 });
  if (arrival.status !== "WAITING_DRIVER" ||
      arrival.createdAt < new Date(Date.now() - ARRIVAL_TTL_MIN * 60_000))
    return NextResponse.json({ error: "Chegada expirada — aproxime o carro da câmera de novo" }, { status: 410 });

  const program = await prisma.program.findFirst({ where: { id: parsed.data.programId, ativo: true } });
  if (!program) return NextResponse.json({ error: "Tipo de lavagem indisponível" }, { status: 404 });

  // Só para vincular a reserva à estação; a liberação é na chegada.
  const machine = await defaultMachine();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const debit = await tx.user.updateMany({
        where: { id: auth.user.id, walletCents: { gte: program.precoCents } },
        data: { walletCents: { decrement: program.precoCents } },
      });
      if (debit.count === 0) throw new Error("SALDO");

      const order = await tx.order.create({
        data: {
          userId: auth.user.id,
          vehicleId: arrival.vehicleId,
          programId: program.id,
          amountCents: program.precoCents,
          voucherCode: voucherCode(),
        },
      });
      // Reserva SEMPRE em HELD: pagar não libera a máquina. Quem libera é a
      // CÂMERA — ao reconhecer a placa na chegada, handlePlateRead promove
      // HELD -> ACTIVE e acende o verde. Assim o carro só é liberado quando
      // está de fato na frente da máquina.
      const reservation = await tx.reservation.create({
        data: {
          userId: auth.user.id,
          vehicleId: arrival.vehicleId!,
          stationId: machine.stationId,
          programId: program.id,
          amountCents: program.precoCents,
          orderId: order.id,
          status: "HELD",
          expiresAt: new Date(Date.now() + HOLD_TTL_MIN * 60_000),
        },
      });

      const upd = await tx.arrival.updateMany({
        where: { id: arrival.id, status: "WAITING_DRIVER" },
        data: { status: "REQUESTED", orderId: order.id, reservationId: reservation.id, requestedAt: new Date() },
      });
      if (upd.count === 0) throw new Error("CORRIDA"); // outra solicitação ganhou

      await tx.walletTx.create({
        data: { userId: auth.user.id, amountCents: -program.precoCents, kind: "WASH", refId: order.id },
      });
      await tx.event.create({
        data: {
          type: "arrival_requested",
          payload: {
            arrivalId: arrival.id, orderId: order.id, programId: program.id,
            plate: arrival.plate, reservationId: reservation.id, reservationStatus: reservation.status,
          },
        },
      });
      return { order, reservation };
    });
    // Nada de acender luz aqui: a liberação acontece na chegada, quando a
    // câmera lê a placa.
    return NextResponse.json(
      {
        ok: true,
        orderId: result.order.id,
        status: "REQUESTED",
        reservationId: result.reservation.id,
        proximoPasso: "Aproxime o carro da câmera para liberar a lavagem",
      },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof Error && e.message === "SALDO")
      return NextResponse.json({ error: "Saldo insuficiente. Adicione saldo para continuar." }, { status: 402 });
    if (e instanceof Error && e.message === "CORRIDA")
      return NextResponse.json({ error: "Lavagem já solicitada" }, { status: 409 });
    console.error("arrival request:", e);
    return NextResponse.json({ error: "Não foi possível concluir. Tente novamente." }, { status: 500 });
  }
}
