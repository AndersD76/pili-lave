import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { HOLD_TTL_MIN, defaultMachine, machineForStation, machineAvailability, setTransientLight } from "@/lib/reservations";
import { diagnosticar } from "@/lib/saude";
import { precoEfetivo } from "@/lib/precos";

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
  /** Unidade escolhida pelo cliente antes de comprar — decide o preço e
   *  qual máquina recebe a reserva. Sem ela (fluxo antigo), cai na
   *  primeira máquina cadastrada. */
  stationId: z.string().optional(),
  /** "cheguei": o cliente já está na máquina e a câmera não o reconheceu.
   *  Libera direto, sem esperar a leitura da placa. */
  jaEstouNaMaquina: z.boolean().optional(),
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

  const machine = vehicle
    ? parsed.data.stationId
      ? await machineForStation(parsed.data.stationId)
      : await defaultMachine()
    : null;
  const precoCents = await precoEfetivo(program.id, machine?.stationId ?? parsed.data.stationId);

  /* Máquina parada (falha, manutenção ou display mudo): não deixa pagar por
   * uma lavagem que não vai acontecer. */
  const saude = await diagnosticar();
  if (!saude.disponivel)
    return NextResponse.json(
      { error: saude.motivo ?? "Máquina não disponível no momento.", indisponivel: true },
      { status: 503 }
    );

  /* Modo "cheguei": libera na hora. Só faz sentido com a máquina LIVRE —
   * se ela estiver lavando outro carro, a reserva entra na fila normal. */
  const agoraNaMaquina = parsed.data.jaEstouNaMaquina === true;
  const maquinaLivre = machine ? machineAvailability(machine) === "FREE" : false;
  const liberarJa = agoraNaMaquina && maquinaLivre && !!machine;

  /* Já tem lavagem paga esperando? NÃO cobra de novo. Antes o débito
   * acontecia e a reserva não era criada (guarda de duplicidade lá
   * embaixo), então cada toque a mais no botão sumia com R$ 15. */
  if (vehicle) {
    const viva = await prisma.reservation.findFirst({
      where: { vehicleId: vehicle.id, status: { in: ["HELD", "ACTIVE", "ENTERED"] } },
      include: { order: true },
    });

    /* "Já estou na máquina" com uma reserva paga esperando: NÃO cobra de
     * novo — libera a que já existe. Era exatamente este o caso de uso do
     * botão (pagou, a câmera não leu a placa, ele quer entrar), e a guarda
     * de cobrança dupla respondia "aproxime o carro da câmera", que é o
     * oposto do que o cliente pediu. */
    if (viva && agoraNaMaquina && viva.status === "HELD" && machine && maquinaLivre) {
      await prisma.reservation.update({
        where: { id: viva.id },
        data: {
          status: "ACTIVE",
          machineId: machine.id,
          stationId: machine.stationId,
          activeAt: new Date(),
        },
      });
      await setTransientLight(machine.id, "GREEN_SOLID", 15 * 60);
      await prisma.event.create({
        data: {
          type: "manual_release",
          payload: { reservationId: viva.id, userId: auth.user.id, plate: vehicle.plate, viaBotao: true },
        },
      });
      return NextResponse.json(
        { ok: true, orderId: viva.orderId, reservationId: viva.id, liberadaAgora: true, jaPaga: true },
        { status: 200 }
      );
    }

    if (viva)
      return NextResponse.json(
        {
          error: viva.status === "HELD"
            ? "Você já tem uma lavagem paga aguardando. Aproxime o carro da câmera ou use \"Já estou na máquina\"."
            : "Você já tem uma lavagem em andamento.",
          orderId: viva.orderId,
          reservationId: viva.id,
        },
        { status: 409 }
      );
  }

  try {
    const order = await prisma.$transaction(async (tx) => {
      // debita com guarda de saldo — falha se ficar negativo
      const debit = await tx.user.updateMany({
        where: { id: auth.user.id, walletCents: { gte: precoCents } },
        data: { walletCents: { decrement: precoCents } },
      });
      if (debit.count === 0) throw new Error("SALDO");

      const order = await tx.order.create({
        data: {
          userId: auth.user.id,
          vehicleId: vehicle?.id ?? null,
          programId: program.id,
          amountCents: precoCents,
          voucherCode: voucherCode(),
        },
        include: { program: true, vehicle: true },
      });

      // Reserva HELD: fica aguardando o carro chegar. Quem promove para
      // ACTIVE (e acende o verde) é a leitura da placa pela câmera.
      // Só uma reserva viva por veículo — não duplica se já existir.
      if (vehicle && machine) {
        // corrida (dois toques ao mesmo tempo): desfaz a compra inteira em
        // vez de debitar sem criar reserva.
        const jaTem = await tx.reservation.findFirst({
          where: { vehicleId: vehicle.id, status: { in: ["HELD", "ACTIVE", "ENTERED"] } },
        });
          if (jaTem) throw new Error("DUPLICADA");
        await tx.reservation.create({
          data: {
            userId: auth.user.id,
            vehicleId: vehicle.id,
            stationId: machine.stationId,
            programId: program.id,
            amountCents: precoCents,
            orderId: order.id,
            // "cheguei" com a máquina livre: já nasce ACTIVE (verde acende
            // e o display recebe a ordem no próximo heartbeat). Caso normal:
            // HELD, esperando a câmera reconhecer a placa na chegada.
            ...(liberarJa
              ? { status: "ACTIVE" as const, machineId: machine.id, activeAt: new Date() }
              : { status: "HELD" as const }),
            expiresAt: new Date(Date.now() + HOLD_TTL_MIN * 60_000),
          },
        });
      }
      await tx.walletTx.create({
        data: { userId: auth.user.id, amountCents: -precoCents, kind: "WASH", refId: order.id },
      });
      await tx.event.create({
        data: { type: "order_created", payload: { userId: auth.user.id, programId: program.id, amountCents: precoCents } },
      });
      return order;
    });
    if (liberarJa && machine) await setTransientLight(machine.id, "GREEN_SOLID", 15 * 60);
    return NextResponse.json({ ...order, liberadaAgora: liberarJa }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message === "SALDO")
      return NextResponse.json({ error: "Saldo insuficiente. Adicione saldo para continuar." }, { status: 402 });
    if (e instanceof Error && e.message === "DUPLICADA")
      return NextResponse.json(
        { error: "Você já tem uma lavagem paga aguardando. Aproxime o carro da câmera." },
        { status: 409 }
      );
    console.error("Order falhou:", e);
    return NextResponse.json({ error: "Não foi possível concluir. Tente novamente." }, { status: 500 });
  }
}
