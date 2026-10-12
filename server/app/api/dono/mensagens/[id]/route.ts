import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { avisarCliente } from "@/lib/push";

const Body = z.object({ resposta: z.string().trim().min(2, "Escreva a resposta").max(1000) });

/** Dono responde uma mensagem de suporte — o cliente é avisado e vê a
 *  resposta na tela da loja. Responder de novo substitui a resposta. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const mensagem = await prisma.lojaMensagem.findFirst({
    where: { id, loja: { donoId: auth.user.id } },
    include: { loja: { select: { name: true } } },
  });
  if (!mensagem) return NextResponse.json({ error: "Mensagem não encontrada" }, { status: 404 });

  const atualizada = await prisma.lojaMensagem.update({
    where: { id },
    data: { resposta: parsed.data.resposta, respondidaEm: new Date() },
  });
  await avisarCliente(mensagem.userId, {
    titulo: `Resposta da loja ${mensagem.loja.name}`,
    corpo: parsed.data.resposta.slice(0, 140),
    url: "/app/loja",
  });
  return NextResponse.json({ ok: true, resposta: atualizada.resposta, respondidaEm: atualizada.respondidaEm });
}
