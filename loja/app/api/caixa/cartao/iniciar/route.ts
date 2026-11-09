import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { conferirCarrinho, MAX_ITENS, MAX_POR_ITEM } from "@/lib/caixa";
import { lojaConfigurada } from "@/lib/config";
import { maquininha } from "@/lib/maquininha";

const Body = z.object({
  itens: z
    .array(z.object({ produtoId: z.string().min(1), quantidade: z.number().int().min(1).max(MAX_POR_ITEM) }))
    .min(1)
    .max(MAX_ITENS),
});

/** Caixa: pede a cobrança pra maquininha (hoje, confirmação manual). Confere
 *  o carrinho de novo antes — não faz sentido começar a cobrar por um
 *  produto que já saiu de linha. */
export async function POST(req: NextRequest) {
  if (!(await lojaConfigurada())) return NextResponse.json({ erro: "Loja não cadastrada" }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Compra inválida." }, { status: 400 });

  const carrinho = await conferirCarrinho(parsed.data.itens);
  if (!carrinho.ok) return NextResponse.json({ erro: carrinho.erro }, { status: 409 });

  const { operacaoId } = await maquininha.iniciar(carrinho.totalCents);
  return NextResponse.json({
    operacaoId, totalCents: carrinho.totalCents, nome: maquininha.nome, confirmacaoManual: maquininha.confirmacaoManual,
  });
}
