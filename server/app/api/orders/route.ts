import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { HOLD_TTL_MIN, defaultMachine } from "@/lib/reservations";

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

/**
 * Compra de lavagem pelo app: debita a carteira, emite o voucher (QR) e
 * ABRE A RESERVA (HELD) quando há veículo — é a reserva que libera a
 * máquina depois, quando a câmera reconhecer a placa na chegada. Sem ela
 * o cliente pagava e a máquina nunca ligava (o voucher só serve para o
 * lavador validar no balcão).
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const program = await prisma.program.findFirst({ where: { id: parsed.data.programId, ativo: true } });
  if (!program) return NextResponse.json({ error: "Tipo de lavagem indisponível" }, { status: 404 });

  // Veículo: o informado, senão o único/primeiro cadastrado do cliente —
  // é o que amarra a reserva à placa que a câmera vai ler na chegada.
  const vehicle = parsed.data.vehicleId
    ? await prisma.vehicle.findFirst({ where: { id: parsed.data.vehicleId, userId: auth.user.id } })
    : await prisma.vehicle.findFirst({ where: { userId: auth.user.id }, orderBy: { createdAt: "asc" } });
  if (parsed.data.vehicleId && !vehicle)
    return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

  const machine = vehicle ? await defaultMachine() : null;

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
          vehicleId: vehicle?.id ?? null,
          programId: program.id,
          amountCents: program.precoCents,
          voucherCode: voucherCode(),
        },
        include: { program: true, vehicle: true },
      });

      // Reserva HELD: fica aguardando o carro chegar. Quem promove para
      // ACTIVE (e acende o verde) é a leitura da placa pela câmera.
      // Só uma reserva viva por veículo — não duplica se já existir.
      if (vehicle && machine) {
        const jaTem = await tx.reservation.findFirst({
          where: { vehicleId: vehicle.id, status: { in: ["HELD", "ACTIVE", "ENTERED"] } },
        });
        if (!jaTem) {
          await tx.reservation.create({
            data: {
              userId: auth.user.id,
              vehicleId: vehicle.id,
              stationId: machine.stationId,
              programId: program.id,
              amountCents: program.precoCents,
              orderId: order.id,
              status: "HELD",
              expiresAt: new Date(Date.now() + HOLD_TTL_MIN * 60_000),
            },
          });
        }
      }
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
