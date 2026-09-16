import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

/**
 * Motorista cancela a reserva — permitido só ANTES de o carro entrar na
 * máquina (HELD/ACTIVE). Depois do X14 o ciclo já começou e não dá mais.
 *
 * ESTORNA o valor: hoje a compra debita na hora (fluxo do app), diferente
 * do desenho antigo em que o débito só acontecia no fim da lavagem. Sem o
 * estorno aqui, cancelar custaria o preço da lavagem ao cliente.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;

  const alvo = await prisma.reservation.findFirst({
    where: { id, userId: auth.user.id },
    include: { order: true },
  });

  let estornadoCents = 0;
  const upd = await prisma.$transaction(async (tx) => {
    const r = await tx.reservation.updateMany({
      where: { id, userId: auth.user.id, status: { in: ["HELD", "ACTIVE"] } },
      data: { status: "CANCELED", machineId: null },
    });
    if (r.count === 0) return r;

    // devolve o que foi pago na compra
    if (alvo?.order && alvo.order.status === "PAID") {
      await tx.order.update({ where: { id: alvo.order.id }, data: { status: "CANCELED" } });
      await tx.user.update({
        where: { id: auth.user.id },
        data: { walletCents: { increment: alvo.amountCents } },
      });
      await tx.walletTx.create({
        data: {
          userId: auth.user.id, amountCents: alvo.amountCents, kind: "ADJUST",
          refId: alvo.order.id, note: "estorno: lavagem cancelada pelo cliente",
        },
      });
      estornadoCents = alvo.amountCents;
    }
    // a chegada deixa de valer, senão a tela segue mostrando a lavagem
    await tx.arrival.updateMany({
      where: { reservationId: id, status: { in: ["WAITING_DRIVER", "REQUESTED", "STARTED"] } },
      data: { status: "EXPIRED" },
    });
    return r;
  });

  if (upd.count === 0) {
    const r = await prisma.reservation.findFirst({ where: { id, userId: auth.user.id } });
    if (!r) return NextResponse.json({ error: "Reserva não encontrada" }, { status: 404 });
    if (r.status === "ENTERED")
      return NextResponse.json({ error: "O carro já entrou na máquina — não dá mais para cancelar" }, { status: 409 });
    return NextResponse.json({ error: `Reserva já está ${r.status}` }, { status: 409 });
  }

  // apaga o verde: a máquina não deve ficar liberada para um carro que desistiu
  if (alvo?.machineId)
    await prisma.machine.update({
      where: { id: alvo.machineId },
      data: { lightState: "OFF", lightUntil: new Date(0) },
    }).catch(() => {});

  await prisma.event.create({
    data: {
      type: "reservation_canceled",
      payload: { reservationId: id, userId: auth.user.id, estornadoCents },
    },
  });
  return NextResponse.json({ ok: true, estornadoCents });
}
