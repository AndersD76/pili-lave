import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { finalizarVenda, MAX_ITENS, MAX_POR_ITEM } from "@/lib/caixa";
import { maquininha } from "@/lib/maquininha";

const Body = z.object({
  operacaoId: z.string().min(1),
  itens: z
    .array(z.object({ produtoId: z.string().min(1), quantidade: z.number().int().min(1).max(MAX_POR_ITEM) }))
    .min(1)
    .max(MAX_ITENS),
  visitaId: z.string().min(1).nullish(),
});

/**
 * Fecha a venda no cartão depois que a maquininha aprovou — confere de
 * novo com o driver (nunca confia só no que a tela mandou) antes de gravar
 * e baixar estoque. `operacaoId` vira o código da venda: se o caixa
 * reenviar (ex.: a resposta se perdeu antes de chegar na tela), a mesma
 * operação não gera venda duplicada (ver codigo @unique em Venda).
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: "Compra inválida." }, { status: 400 });
  const { operacaoId } = parsed.data;

  const status = await maquininha.consultar(operacaoId);
  if (status.situacao !== "APROVADO")
    return NextResponse.json(
      { ok: false, erro: status.situacao === "RECUSADO" ? status.motivo : "A cobrança ainda não foi aprovada." },
      { status: 409 }
    );

  const r = await finalizarVenda(parsed.data.itens, "MAQUININHA", operacaoId, parsed.data.visitaId);
  return NextResponse.json(r, { status: r.ok ? 201 : 409 });
}
