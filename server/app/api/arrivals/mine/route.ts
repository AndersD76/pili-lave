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
        // sugestão de baixa confiança: janela curta, some sozinha se o
        // motorista não responder (a próxima leitura tenta de novo).
        { status: "SUGGESTED", createdAt: { gte: new Date(Date.now() - 2 * 60_000) } },
        {
          status: { in: ["REQUESTED", "STARTED"] },
          createdAt: { gte: new Date(Date.now() - 60 * 60_000) },
          /* A chegada NÃO muda de status quando a lavagem acaba, então uma
           * chegada velha ficava sendo devolvida para sempre e a tela
           * mostrava "Lavagem interrompida" mesmo com uma reserva nova.
           * Mas descartar TODA lavagem encerrada era o outro extremo: o
           * cliente terminava a lavagem e a tela voltava ao normal na
           * hora, sem ele ver "pode sair" nem o aviso do estorno.
           * Regra: lavagem viva sempre; lavagem encerrada só por 5 min,
           * tempo de o cliente ler o desfecho. */
          OR: [
            { reservationId: null },
            { reservation: { status: { in: ["HELD", "ACTIVE", "ENTERED"] } } },
            // concluída: completedAt marca a hora exata do fim
            {
              reservation: {
                status: "COMPLETED",
                completedAt: { gte: new Date(Date.now() - 5 * 60_000) },
              },
            },
            /* falhada: a reserva não guarda "quando falhou", então usa a
             * hora da CHEGADA — a falha acontece durante a lavagem, que
             * começa poucos minutos depois de o carro chegar. */
            {
              reservation: { status: "FAILED" },
              createdAt: { gte: new Date(Date.now() - 20 * 60_000) },
            },
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
    // reservaId: o app precisa dele para o botão de cancelar
    return NextResponse.json({
      arrival: {
        ...arrival,
        lavagem: arrival.reservation?.status ?? null,
        reservaId: arrival.reservationId,
      },
    });

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
      stationId: viva.stationId,
      lavagem: viva.status,
      reservaId: viva.id,
      semChegada: true,   // a câmera ainda não leu a placa
    },
  });
}
