import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { finalizarVenda, MAX_ITENS, MAX_POR_ITEM } from "@/lib/caixa";
import { lojaConfigurada } from "@/lib/config";

const Body = z.object({
  itens: z
    .array(z.object({ produtoId: z.string().min(1), quantidade: z.number().int().min(1).max(MAX_POR_ITEM) }))
    .min(1)
    .max(MAX_ITENS),
});

/** Caixa: fecha a compra. A tela manda só produto e quantidade — preço e
 *  total são calculados aqui, do cadastro. */
export async function POST(req: NextRequest) {
  if (!(await lojaConfigurada())) return NextResponse.json({ error: "Loja não cadastrada" }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: "Compra inválida." }, { status: 400 });
  const r = await finalizarVenda(parsed.data.itens, "SIMULADO");
  return NextResponse.json(r, { status: r.ok ? 201 : 409 });
}
