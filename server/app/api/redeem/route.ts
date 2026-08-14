import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const Body = z.object({ code: z.string().min(6).max(40) });

/** Lavador escaneia o QR do cliente: valida, marca como resgatado e libera. */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req, "LAVADOR");
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Código inválido" }, { status: 400 });

  // aceita o conteúdo cru do QR ("PILILAVE:XXXX") ou só o código
  const code = parsed.data.code.replace(/^PILILAVE:/i, "").toUpperCase().trim();

  const order = await prisma.order.findUnique({
    where: { voucherCode: code },
    include: { program: true, vehicle: true, user: true },
  });
  if (!order) return NextResponse.json({ error: "Voucher não encontrado" }, { status: 404 });
  if (order.status === "REDEEMED")
    return NextResponse.json({
      error: "Voucher já utilizado",
      redeemedAt: order.redeemedAt,
    }, { status: 409 });
  if (order.status === "CANCELED")
    return NextResponse.json({ error: "Voucher cancelado" }, { status: 409 });
  if (order.voucherExpiresAt && order.voucherExpiresAt < new Date())
    return NextResponse.json({ error: "Voucher expirado" }, { status: 409 });

  const updated = await prisma.order.update({
    where: { id: order.id, status: "PAID" },
    data: { status: "REDEEMED", redeemedAt: new Date(), redeemedById: auth.user.id },
  });
  await prisma.event.create({
    data: {
      type: "order_redeemed",
      payload: { orderId: order.id, programId: order.programId, lavadorId: auth.user.id },
    },
  });

  return NextResponse.json({
    ok: true,
    program: { id: order.program.id, nome: order.program.nome },
    plate: order.vehicle?.plate ?? null,
    clientName: order.user.name,
    amountCents: order.amountCents,
    redeemedAt: updated.redeemedAt,
  });
}
