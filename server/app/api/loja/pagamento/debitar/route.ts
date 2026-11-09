import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verificarTokenPagamentoLoja } from "@/lib/auth";
import { lojaPorDeviceKey } from "@/lib/loja";
import { prisma } from "@/lib/prisma";

const Body = z.object({
  token: z.string().min(10),
  totalCents: z.number().int().positive(),
  /** Código da venda no computador da loja (cuid, único por loja) — é por
   *  ele que um reenvio depois de queda de rede não cobra duas vezes. */
  vendaCodigo: z.string().min(10),
  itens: z.number().int().positive(), // só pra nota legível, não confere preço
});

/**
 * Debita a carteira do cliente pra uma compra na loja. Chamada pelo caixa
 * depois que o cliente confirma "Pagando: Fulano — saldo R$ X" (identificar
 * já mostrou isso). O preço em si é responsabilidade do caixa — aqui só
 * confere se o token é válido e se há saldo.
 *
 * Idempotente por vendaCodigo: se o caixa reenviar (rede caiu antes da
 * resposta chegar), devolve ok de novo sem debitar duas vezes.
 */
export async function POST(req: NextRequest) {
  const loja = await lojaPorDeviceKey(req);
  if (!loja) return NextResponse.json({ error: "Computador não cadastrado" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const { token, totalCents, vendaCodigo, itens } = parsed.data;

  const jaFeita = await prisma.walletTx.findFirst({ where: { kind: "LOJA", refId: vendaCodigo } });
  if (jaFeita) return NextResponse.json({ ok: true, jaProcessada: true });

  const userId = await verificarTokenPagamentoLoja(token);
  if (!userId) return NextResponse.json({ error: "QR expirado. Peça pro cliente abrir a tela de novo." }, { status: 410 });

  try {
    await prisma.$transaction(async (tx) => {
      const debito = await tx.user.updateMany({
        where: { id: userId, walletCents: { gte: totalCents } },
        data: { walletCents: { decrement: totalCents } },
      });
      if (debito.count === 0) throw new Error("SALDO");
      await tx.walletTx.create({
        data: {
          userId, amountCents: -totalCents, kind: "LOJA", refId: vendaCodigo,
          note: `Loja ${loja.name} · ${itens} ${itens === 1 ? "item" : "itens"}`,
        },
      });
      await tx.event.create({
        data: { type: "loja_pagamento", payload: { lojaId: loja.id, userId, totalCents, vendaCodigo } },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "SALDO")
      return NextResponse.json({ error: "Saldo insuficiente" }, { status: 402 });
    throw e;
  }

  return NextResponse.json({ ok: true });
}
