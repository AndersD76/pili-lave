import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ABERTURA_VALIDADE_MS, lojaDoDono } from "@/lib/loja";

const Body = z.object({ motivo: z.string().trim().max(200).default("") });

function situacao(a: { pedidaEm: Date; feitaEm: Date | null }): "ABERTA" | "AGUARDANDO" | "EXPIRADA" {
  if (a.feitaEm) return "ABERTA";
  return Date.now() - a.pedidaEm.getTime() < ABERTURA_VALIDADE_MS ? "AGUARDANDO" : "EXPIRADA";
}

/**
 * Abertura remota da porta — só o dono da loja. O pedido fica registrado no
 * nome dele e vale por pouco tempo: o computador da loja busca, abre e
 * confirma. Se a loja estiver sem internet o pedido expira sem abrir.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const loja = await lojaDoDono(id, auth.user.id);
  if (!loja) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  if (!loja.deviceKey)
    return NextResponse.json({ error: "Esta loja ainda não tem computador vinculado" }, { status: 409 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  // um toque repetido não vira duas aberturas: devolve o pedido que já está valendo
  const pendente = await prisma.lojaAberturaRemota.findFirst({
    where: { lojaId: id, feitaEm: null, pedidaEm: { gt: new Date(Date.now() - ABERTURA_VALIDADE_MS) } },
  });
  if (pendente) return NextResponse.json({ id: pendente.id, situacao: "AGUARDANDO", pedidaEm: pendente.pedidaEm });

  const abertura = await prisma.lojaAberturaRemota.create({
    data: { lojaId: id, pedidaPorId: auth.user.id, motivo: parsed.data.motivo },
  });
  await prisma.event.create({
    data: {
      type: "loja_abertura_remota_pedida",
      payload: { lojaId: id, aberturaId: abertura.id, donoId: auth.user.id, motivo: parsed.data.motivo },
    },
  });
  return NextResponse.json({ id: abertura.id, situacao: "AGUARDANDO", pedidaEm: abertura.pedidaEm }, { status: 201 });
}

/** Últimos pedidos de abertura (o app consulta pra saber se a porta abriu). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (!(await lojaDoDono(id, auth.user.id)))
    return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  const aberturas = await prisma.lojaAberturaRemota.findMany({
    where: { lojaId: id }, orderBy: { pedidaEm: "desc" }, take: 10,
  });
  return NextResponse.json({
    aberturas: aberturas.map((a) => ({
      id: a.id, motivo: a.motivo, pedidaEm: a.pedidaEm, feitaEm: a.feitaEm, situacao: situacao(a),
    })),
  });
}
