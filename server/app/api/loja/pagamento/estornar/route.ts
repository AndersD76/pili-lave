import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { lojaPorDeviceKey } from "@/lib/loja";
import { prisma } from "@/lib/prisma";

const Body = z.object({ vendaCodigo: z.string().min(10) });

function refIdEstorno(vendaCodigo: string): string {
  return `estorno:${vendaCodigo}`;
}

/**
 * Devolve pra carteira o valor de uma compra na loja. Usada só quando o
 * débito foi feito mas o caixa não conseguiu concluir a venda localmente
 * depois (ex.: produto saiu de linha no meio do caminho) — pra o cliente
 * nunca ficar pagando por nada. Idempotente pelo mesmo vendaCodigo: chamar
 * duas vezes não devolve em dobro.
 */
export async function POST(req: NextRequest) {
  const loja = await lojaPorDeviceKey(req);
  if (!loja) return NextResponse.json({ error: "Computador não cadastrado" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const { vendaCodigo } = parsed.data;

  const jaEstornada = await prisma.walletTx.findFirst({ where: { kind: "REFUND", refId: refIdEstorno(vendaCodigo) } });
  if (jaEstornada) return NextResponse.json({ ok: true, jaProcessado: true });

  const original = await prisma.walletTx.findFirst({ where: { kind: "LOJA", refId: vendaCodigo } });
  if (!original) return NextResponse.json({ error: "Pagamento não encontrado" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: original.userId }, data: { walletCents: { increment: -original.amountCents } } });
    await tx.walletTx.create({
      data: {
        userId: original.userId, amountCents: -original.amountCents, kind: "REFUND",
        refId: refIdEstorno(vendaCodigo), note: `Loja ${loja.name} · venda não concluída`,
      },
    });
    await tx.event.create({ data: { type: "loja_pagamento_estornado", payload: { lojaId: loja.id, vendaCodigo } } });
  });

  return NextResponse.json({ ok: true });
}
