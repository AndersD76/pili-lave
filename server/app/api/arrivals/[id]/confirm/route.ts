import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { handlePlateRead } from "@/lib/lpr";

const Body = z.object({ confirm: z.boolean() });

/**
 * Resposta do motorista a uma chegada SUGERIDA (leitura de placa fraca que
 * bateu com a fila — ver suggestFromWeakRead em lib/lpr.ts).
 *
 * confirm=true:  trata como se a câmera tivesse lido a placa com confiança —
 *                reusa handlePlateRead com a placa REAL do veículo (a mesma
 *                que já validamos contra a fila), que promove a reserva
 *                HELD -> ACTIVE e acende o verde quando a máquina está livre.
 * confirm=false: descarta a sugestão; a reserva continua HELD normalmente,
 *                esperando uma leitura de verdade (ou nova sugestão).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "confirm obrigatório" }, { status: 400 });

  const arrival = await prisma.arrival.findFirst({ where: { id, userId: auth.user.id } });
  if (!arrival) return NextResponse.json({ error: "Chegada não encontrada" }, { status: 404 });
  if (arrival.status !== "SUGGESTED")
    return NextResponse.json({ error: "Esta sugestão já não está mais válida" }, { status: 409 });

  if (!parsed.data.confirm) {
    await prisma.arrival.update({ where: { id: arrival.id }, data: { status: "EXPIRED" } });
    return NextResponse.json({ ok: true, status: "EXPIRED" });
  }

  // Sugestão descartada (vira histórico); quem processa de fato é o
  // handlePlateRead abaixo, que cria a chegada definitiva.
  await prisma.arrival.update({ where: { id: arrival.id }, data: { status: "EXPIRED" } });
  const result = await handlePlateRead(arrival.plate);
  return NextResponse.json({ ok: true, ...result });
}
