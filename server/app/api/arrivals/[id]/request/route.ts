import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ARRIVAL_TTL_MIN } from "@/lib/device";

const Body = z.object({ programId: z.number().int() });

function voucherCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(10), (b) => alphabet[b % 32]).join("");
}

/**
 * Motorista solicita a lavagem do carro que a câmera reconheceu:
 * debita o saldo, cria o pedido e marca a chegada como REQUESTED —
 * a máquina pega no próximo polling e acende a luz verde.
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
      const upd = await tx.arrival.updateMany({
        where: { id: arrival.id, status: "WAITING_DRIVER" },
        data: { status: "REQUESTED", orderId: order.id, requestedAt: new Date() },
      });
      if (upd.count === 0) throw new Error("CORRIDA"); // outra solicitação ganhou

      await tx.walletTx.create({
        data: { userId: auth.user.id, amountCents: -program.precoCents, kind: "WASH", refId: order.id },
      });
      await tx.event.create({
        data: {
          type: "arrival_requested",
          payload: { arrivalId: arrival.id, orderId: order.id, programId: program.id, plate: arrival.plate },
        },
      });
      return order;
    });
    return NextResponse.json({ ok: true, orderId: result.id, status: "REQUESTED" }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message === "SALDO")
      return NextResponse.json({ error: "Saldo insuficiente. Adicione saldo para continuar." }, { status: 402 });
    if (e instanceof Error && e.message === "CORRIDA")
      return NextResponse.json({ error: "Lavagem já solicitada" }, { status: 409 });
    console.error("arrival request:", e);
    return NextResponse.json({ error: "Não foi possível concluir. Tente novamente." }, { status: 500 });
  }
}
