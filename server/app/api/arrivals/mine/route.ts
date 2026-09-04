import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ARRIVAL_TTL_MIN } from "@/lib/device";

/** Chegada ativa do usuário (o app faz polling p/ mostrar "seu carro chegou"). */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const cutoff = new Date(Date.now() - ARRIVAL_TTL_MIN * 60_000);
  const arrival = await prisma.arrival.findFirst({
    where: {
      userId: auth.user.id,
      OR: [
        { status: "WAITING_DRIVER", createdAt: { gte: cutoff } },
        {
          status: { in: ["REQUESTED", "STARTED"] },
          createdAt: { gte: new Date(Date.now() - 60 * 60_000) },
          /* A chegada NÃO muda de status quando a lavagem acaba: uma
           * chegada velha, de uma lavagem já concluída ou falhada, ficava
           * sendo devolvida e a tela mostrava "Lavagem interrompida"
           * mesmo com uma reserva nova em andamento. Só vale a chegada
           * cuja lavagem ainda está viva (ou que nem chegou a ter uma). */
          OR: [
            { reservationId: null },
            { reservation: { status: { in: ["HELD", "ACTIVE", "ENTERED"] } } },
          ],
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      vehicle: { select: { plate: true, defaultProgramId: true } },
      // o status da CHEGADA não conta o fim da história: ela fica em
      // REQUESTED mesmo depois da lavagem concluir ou falhar. Quem sabe o
      // que aconteceu na máquina é a reserva.
      reservation: { select: { status: true } },
    },
  });
  if (arrival)
    return NextResponse.json({ arrival: { ...arrival, lavagem: arrival.reservation?.status ?? null } });

  /* Sem chegada, mas com lavagem paga esperando o carro: quem compra pela
   * tela "Nova lavagem" só ganha uma chegada quando a câmera lê a placa.
   * Devolve a reserva viva para o app acompanhar desde o pagamento. */
  const viva = await prisma.reservation.findFirst({
    where: { userId: auth.user.id, status: { in: ["HELD", "ACTIVE", "ENTERED"] } },
    orderBy: { createdAt: "desc" },
    include: { vehicle: { select: { plate: true, defaultProgramId: true } } },
  });
  if (!viva) return NextResponse.json({ arrival: null });

  return NextResponse.json({
    arrival: {
      id: viva.id,
      plate: viva.vehicle.plate,
      status: "REQUESTED",
      vehicle: viva.vehicle,
      lavagem: viva.status,
      semChegada: true,   // a câmera ainda não leu a placa
    },
  });
}
