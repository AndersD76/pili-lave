import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

function alertaDoDono(id: string, donoId: string) {
  return prisma.lojaAlerta.findFirst({ where: { id, loja: { donoId } } });
}

/** As imagens de um aviso (JPEG em base64), na ordem em que a loja mandou. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (!(await alertaDoDono(id, auth.user.id)))
    return NextResponse.json({ error: "Aviso não encontrado" }, { status: 404 });

  const imagens = await prisma.lojaAlertaImagem.findMany({ where: { alertaId: id }, orderBy: { ordem: "asc" } });
  return NextResponse.json({ imagens: imagens.map((i) => Buffer.from(i.jpeg).toString("base64")) });
}

/** Dono marca o aviso como lido. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const alerta = await alertaDoDono(id, auth.user.id);
  if (!alerta) return NextResponse.json({ error: "Aviso não encontrado" }, { status: 404 });

  if (!alerta.lidoEm) await prisma.lojaAlerta.update({ where: { id }, data: { lidoEm: new Date() } });
  return NextResponse.json({ ok: true });
}
