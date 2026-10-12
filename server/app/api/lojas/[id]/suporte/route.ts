import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { avisarAdmins, avisarCliente } from "@/lib/push";

const Body = z.object({ texto: z.string().trim().min(5, "Escreva sua mensagem").max(1000) });

/** Uma pessoa não fica mandando mensagem em série enquanto espera resposta. */
const MAX_SEM_RESPOSTA = 3;

/**
 * Mensagem do cliente pro suporte de uma loja — é por aqui que quem foi
 * bloqueado pede revisão. Chega no app do dono (aviso + tela "Minha loja"),
 * que responde em até 24h. Loja sem dono definido: avisa os admins.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const loja = await prisma.loja.findFirst({ where: { id, active: true } });
  if (!loja) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  const semResposta = await prisma.lojaMensagem.count({
    where: { lojaId: id, userId: auth.user.id, respondidaEm: null },
  });
  if (semResposta >= MAX_SEM_RESPOSTA)
    return NextResponse.json(
      { error: "Você já tem mensagens aguardando resposta. O retorno pode levar até 24 horas." },
      { status: 429 }
    );

  const mensagem = await prisma.lojaMensagem.create({
    data: { lojaId: id, userId: auth.user.id, texto: parsed.data.texto },
    select: { id: true, texto: true, criadaEm: true, resposta: true, respondidaEm: true },
  });

  const aviso = {
    titulo: `Mensagem de cliente — ${loja.name}`,
    corpo: `${auth.user.name ?? "Cliente"} (código ${auth.user.codigoCliente}): ${parsed.data.texto.slice(0, 120)}`,
    url: "/app/minha-loja",
  };
  if (loja.donoId) await avisarCliente(loja.donoId, aviso);
  else await avisarAdmins(aviso);

  return NextResponse.json({ mensagem }, { status: 201 });
}
