import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { lojaPorDeviceKey } from "@/lib/loja";

/** No máximo isso por chamada — o computador da loja manda em lotes,
 *  mesmo que a fila atrasada tenha mais. */
const MAX_LOTE = 50;

const Body = z.object({
  vendas: z
    .array(
      z.object({
        codigo: z.string().min(1),
        totalCents: z.number().int().min(0),
        forma: z.string().min(1),
        criadaEm: z.string(),
        itens: z.array(
          z.object({
            nome: z.string().min(1), ean: z.string().nullable(), quantidade: z.number().int().min(1), precoUnitCents: z.number().int().min(0),
          })
        ),
      })
    )
    .min(1)
    .max(MAX_LOTE),
});

/**
 * O computador da loja manda aqui as vendas que ainda não sincronizou —
 * é só uma cópia pra alimentar indicadores (etapa 7); o estoque e a gestão
 * da venda continuam no banco local. Idempotente por `codigo`: reenviar uma
 * venda que já chegou não duplica, e a loja marca como sincronizada tudo
 * que estiver na lista devolvida, mesmo o que já existia de antes.
 */
export async function POST(req: NextRequest) {
  const loja = await lojaPorDeviceKey(req);
  if (!loja) return NextResponse.json({ erro: "Loja não identificada" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const sincronizados: string[] = [];
  for (const v of parsed.data.vendas) {
    const existente = await prisma.vendaLoja.findUnique({ where: { codigo: v.codigo } });
    if (!existente) {
      await prisma.vendaLoja.create({
        data: {
          lojaId: loja.id, codigo: v.codigo, totalCents: v.totalCents, forma: v.forma, criadaEm: new Date(v.criadaEm),
          itens: { create: v.itens.map((i) => ({ nome: i.nome, ean: i.ean, quantidade: i.quantidade, precoUnitCents: i.precoUnitCents })) },
        },
      });
    }
    sincronizados.push(v.codigo);
  }

  return NextResponse.json({ sincronizados });
}
