import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMachine } from "@/lib/device";

const Body = z.object({
  errorCode: z.string().max(64).optional(),
  reservationId: z.string().optional(),
});

/**
 * AUTO_ERRO: a máquina falhou. A reserva em andamento vira FAILED e, se a
 * lavagem JÁ FOI PAGA no app, o valor é ESTORNADO na hora — o cliente pagou
 * e não recebeu o serviço. Idempotente: retransmissões do ESP32 não
 * estornam duas vezes (só reservas ACTIVE/ENTERED são afetadas).
 * A lâmpada fica em vermelho piscando até o admin resolver.
 */
export async function POST(req: NextRequest) {
  const auth = await requireMachine(req);
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const body = parsed.success ? parsed.data : {};

  // Pega as reservas atingidas ANTES de marcar FAILED, para saber o que
  // estornar. Se o id enviado não casar (o display guarda o último na NVS
  // e não o limpa), vale a reserva em andamento da máquina.
  const emAndamento = await prisma.reservation.findMany({
    where: {
      machineId: auth.machine.id,
      status: { in: ["ACTIVE", "ENTERED"] },
      ...(body.reservationId ? { id: body.reservationId } : {}),
    },
    include: { order: true },
  });
  const alvos =
    emAndamento.length > 0 || !body.reservationId
      ? emAndamento
      : await prisma.reservation.findMany({
          where: { machineId: auth.machine.id, status: { in: ["ACTIVE", "ENTERED"] } },
          include: { order: true },
        });

  let estornadas = 0;
  let estornoCents = 0;
  for (const r of alvos) {
    await prisma.$transaction(async (tx) => {
      // trava contra corrida: só age se ainda estiver em andamento
      const upd = await tx.reservation.updateMany({
        where: { id: r.id, status: { in: ["ACTIVE", "ENTERED"] } },
        data: { status: "FAILED" },
      });
      if (upd.count === 0) return;

      // Pago no app (compra debitada na hora)? devolve o dinheiro.
      if (r.order && r.order.status === "PAID") {
        await tx.order.update({ where: { id: r.order.id }, data: { status: "CANCELED" } });
        await tx.user.update({
          where: { id: r.userId },
          data: { walletCents: { increment: r.amountCents } },
        });
        await tx.walletTx.create({
          data: {
            userId: r.userId,
            amountCents: r.amountCents,
            kind: "ADJUST",
            refId: r.order.id,
            note: "estorno automático: falha da máquina durante a lavagem",
          },
        });
        estornadas++;
        estornoCents += r.amountCents;
      }
    });
  }
  const affected = { count: alvos.length };

  await prisma.machine.update({
    where: { id: auth.machine.id },
    data: { status: "FAULT", remainingSec: 0, lightState: "RED_BLINK", lightUntil: null },
  });
  await prisma.event.create({
    data: {
      type: "machine_fault",
      payload: {
        machineId: auth.machine.id,
        errorCode: body.errorCode ?? null,
        failedReservations: affected.count,
        estornadas,
        estornoCents,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    failedReservations: affected.count,
    estornadas,
    estornoCents,
  });
}
