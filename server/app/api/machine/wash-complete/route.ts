import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMachine } from "@/lib/device";
import { DONE_GREEN_S } from "@/lib/reservations";
import { avisarCliente } from "@/lib/push";
import { precoEfetivo } from "@/lib/precos";

const Body = z.object({
  reservationId: z.string().optional(),
  /** "remote" = terminou pelos botões físicos X1-X6, sem reserva de app —
   *  lavagem PAGA EM DINHEIRO na hora (ver MSG_EVT no firmware).
   *  "socio" / "bonus" (firmware de 2026-11-02): mesma coisa, mas a lavagem NÃO foi paga na hora (sócio mensalista ou bônus de promoção). */
  source: z.string().optional(),
  programId: z.number().int().min(1).max(4).optional(),
});

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
  // tipo da lavagem local, quando o firmware informa: remote = presencial (dinheiro), socio, bonus
  const TIPOS_LOCAIS: Record<string, "PRESENCIAL" | "SOCIO" | "BONUS"> = { remote: "PRESENCIAL", socio: "SOCIO", bonus: "BONUS" };
  const tipoLocal = parsed.success && parsed.data.source ? TIPOS_LOCAIS[parsed.data.source] : undefined;
  const remoto = tipoLocal !== undefined;
  const programIdRemoto = parsed.success ? parsed.data.programId : undefined;

  // Mesmo caso do car-entered: o id que o display manda pode ser de uma
  // reserva antiga (a NVS dele não é limpa). Se não casar, conclui a
  // reserva ENTERED da máquina — é a lavagem que realmente aconteceu.
  const reservation =
    (await prisma.reservation.findFirst({
      where: { machineId: auth.machine.id, status: "ENTERED", ...(wanted ? { id: wanted } : {}) },
      orderBy: { enteredAt: "asc" },
    })) ??
    (wanted
      ? await prisma.reservation.findFirst({
          where: { machineId: auth.machine.id, status: "ENTERED" },
          orderBy: { enteredAt: "asc" },
        })
      : null);

  if (!reservation) {
    // retransmissão de um complete já processado? SÓ dá para saber quando a máquina manda o id da reserva. Sem id (lavagem presencial / sócio /
    // bônus) NÃO se pode procurar "a última concluída da máquina": antes isso devolvia "dedup" para qualquer presencial assim que a máquina tivesse
    // UMA lavagem de app concluída, e a lavagem presencial nunca era registrada (corrigido em 2026-11-02).
    const done = wanted
      ? await prisma.reservation.findFirst({
          where: { machineId: auth.machine.id, status: "COMPLETED", id: wanted },
          orderBy: { completedAt: "desc" },
        })
      : null;
    if (done) return NextResponse.json({ ok: true, reservationId: done.id, dedup: true });

    // Presencial (paga em dinheiro nos botões X1-X6, sem reserva nenhuma) —
    // sem controle de idempotência por id (o firmware não manda um; uma
    // retransmissão rara duplicando o registro é aceitável, é só um
    // contador pro lavador, não mexe em saldo/débito de ninguém).
    if (remoto && programIdRemoto) {
      // sócio e bônus não geram dinheiro na hora: contam como lavagem, mas com valor 0 (não entram no "deve repassar" do lavador)
      const amountCents = tipoLocal === "PRESENCIAL" ? await precoEfetivo(programIdRemoto, auth.machine.stationId) : 0;
      const lav = await prisma.lavagemPresencial.create({
        data: { machineId: auth.machine.id, programId: programIdRemoto, amountCents },
      });
      if (tipoLocal !== "PRESENCIAL") {
        // o tipo fica num Event (sem coluna nova): o resumo da máquina conta sócios e bônus por aqui
        await prisma.event.create({
          data: { type: "lavagem_tipo", payload: { lavagemId: lav.id, machineId: auth.machine.id, programId: programIdRemoto, tipo: tipoLocal } },
        });
      }
      return NextResponse.json({ ok: true, presencial: true, tipo: tipoLocal });
    }

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

    // Se a reserva já nasceu de uma compra paga no app (orderId preenchido),
    // o valor JÁ foi debitado ali — aqui só marca a Order como usada. Sem
    // esta guarda o cliente pagava duas vezes pela mesma lavagem.
    const jaPago = reservation.orderId
      ? await tx.order.findUnique({ where: { id: reservation.orderId } })
      : null;

    const order = jaPago
      ? await tx.order.update({
          where: { id: jaPago.id },
          data: { status: "REDEEMED", redeemedAt: new Date() },
        })
      : await tx.order.create({
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

    if (!jaPago) {
      await tx.reservation.update({ where: { id: reservation.id }, data: { orderId: order.id } });
      // o valor estava garantido pela reserva desde a criação — débito direto
      await tx.user.update({
        where: { id: reservation.userId },
        data: { walletCents: { decrement: reservation.amountCents } },
      });
      await tx.walletTx.create({
        data: { userId: reservation.userId, amountCents: -reservation.amountCents, kind: "WASH", refId: order.id },
      });
    }
    const washCounterField =
      reservation.programId >= 1 && reservation.programId <= 4
        ? (`totalWashesM${reservation.programId}` as const)
        : null;
    await tx.machine.update({
      where: { id: auth.machine.id },
      data: {
        status: "FREE",
        remainingSec: 0,
        lightState: "GREEN_SOLID",
        lightUntil: new Date(Date.now() + DONE_GREEN_S * 1000),
        totalWashesAll: { increment: 1 },
        ...(washCounterField ? { [washCounterField]: { increment: 1 } } : {}),
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

  void avisarCliente(reservation.userId, {
    titulo: "Lavagem finalizada!",
    corpo: "Pode sair. Tenha um bom dia!",
    tag: "lavagem",
  });
  return NextResponse.json({ ok: true, reservationId: reservation.id, orderId: result.id });
}
