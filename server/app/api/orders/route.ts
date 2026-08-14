import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

function voucherCode(): string {
  // 10 chars base32 sem ambíguos (sem 0/O/1/I)
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(10), (b) => alphabet[b % 32]).join("");
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const orders = await prisma.order.findMany({
    where: { userId: auth.user.id },
    include: { program: true, vehicle: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(orders);
}

const Body = z.object({
  programId: z.number().int(),
  vehicleId: z.string().optional(),
});

/** Compra de lavagem: debita a carteira e emite o voucher (QR). Atômico. */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const program = await prisma.program.findFirst({ where: { id: parsed.data.programId, ativo: true } });
  if (!program) return NextResponse.json({ error: "Tipo de lavagem indisponível" }, { status: 404 });

  if (parsed.data.vehicleId) {
    const v = await prisma.vehicle.findFirst({ where: { id: parsed.data.vehicleId, userId: auth.user.id } });
    if (!v) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
  }

  try {
    const order = await prisma.$transaction(async (tx) => {
      // debita com guarda de saldo — falha se ficar negativo
      const debit = await tx.user.updateMany({
        where: { id: auth.user.id, walletCents: { gte: program.precoCents } },
        data: { walletCents: { decrement: program.precoCents } },
      });
      if (debit.count === 0) throw new Error("SALDO");

      const order = await tx.order.create({
        data: {
          userId: auth.user.id,
          vehicleId: parsed.data.vehicleId ?? null,
          programId: program.id,
          amountCents: program.precoCents,
          voucherCode: voucherCode(),
        },
        include: { program: true, vehicle: true },
      });
      await tx.walletTx.create({
        data: { userId: auth.user.id, amountCents: -program.precoCents, kind: "WASH", refId: order.id },
      });
      await tx.event.create({
        data: { type: "order_created", payload: { userId: auth.user.id, programId: program.id, amountCents: program.precoCents } },
      });
      return order;
    });
    return NextResponse.json(order, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message === "SALDO")
      return NextResponse.json({ error: "Saldo insuficiente. Adicione saldo para continuar." }, { status: 402 });
    console.error("Order falhou:", e);
    return NextResponse.json({ error: "Não foi possível concluir. Tente novamente." }, { status: 500 });
  }
}
