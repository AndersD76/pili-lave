import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lojaPorDeviceKey } from "@/lib/loja";

/** O computador da loja confirma que abriu a porta pedida pelo dono.
 *  Idempotente: confirmar de novo só devolve ok. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const loja = await lojaPorDeviceKey(req);
  if (!loja) return NextResponse.json({ erro: "Loja não identificada" }, { status: 401 });
  const { id } = await ctx.params;

  const abertura = await prisma.lojaAberturaRemota.findFirst({ where: { id, lojaId: loja.id } });
  if (!abertura) return NextResponse.json({ erro: "Comando não encontrado" }, { status: 404 });
  if (abertura.feitaEm) return NextResponse.json({ ok: true, jaConfirmado: true });

  await prisma.lojaAberturaRemota.update({ where: { id }, data: { feitaEm: new Date() } });
  await prisma.event.create({
    data: { type: "loja_abertura_remota_feita", payload: { lojaId: loja.id, aberturaId: id, donoId: abertura.pedidaPorId } },
  });
  return NextResponse.json({ ok: true });
}
