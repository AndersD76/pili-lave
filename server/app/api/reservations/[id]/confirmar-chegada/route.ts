import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { handlePlateRead } from "@/lib/lpr";

const Body = z.object({
  // exige o toque explícito do cliente — sem isso não libera nada. É o
  // "estou ciente que isso vai debitar meu crédito ao terminar" do app.
  confirmo: z.literal(true),
});

/**
 * "Cheguei" manual: o cliente já está na frente da máquina mas a câmera não
 * reconheceu a placa (sujeira, luz, placa fora do ângulo etc.). Em vez de
 * ficar preso esperando a leitura, ele mesmo confirma a chegada no app.
 *
 * Reaproveita handlePlateRead com a placa CADASTRADA do veículo da própria
 * reserva — o mesmo caminho que a câmera usaria — então o comportamento é
 * idêntico ao automático: máquina livre -> ACTIVE (verde acende); máquina
 * ocupada -> entra na fila (HELD com relógio congelado), sem precisar
 * apertar de novo quando a vez chegar.
 *
 * O valor só é debitado quando a lavagem TERMINA (ver wash-complete) — este
 * botão não cobra nada sozinho, só evita a lavagem travar por falha da
 * câmera. O aviso de "vai debitar" é responsabilidade da tela no app, antes
 * de chamar esta rota.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Confirme que está ciente antes de liberar" }, { status: 400 });

  const reservation = await prisma.reservation.findFirst({
    where: { id, userId: auth.user.id },
    include: { vehicle: true },
  });
  if (!reservation) return NextResponse.json({ error: "Reserva não encontrada" }, { status: 404 });

  if (reservation.status === "EXPIRED" || reservation.status === "CANCELED" || reservation.status === "FAILED")
    return NextResponse.json({ error: "Esta reserva não está mais válida" }, { status: 409 });
  if (reservation.status === "ENTERED" || reservation.status === "COMPLETED")
    return NextResponse.json({ ok: true, status: reservation.status }); // idempotente: já passou daqui

  await prisma.event.create({
    data: { type: "manual_release", payload: { reservationId: reservation.id, userId: auth.user.id, plate: reservation.vehicle.plate } },
  });

  const result = await handlePlateRead(reservation.vehicle.plate);
  return NextResponse.json({ ok: true, ...result });
}
