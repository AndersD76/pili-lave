import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { lojaDoDono } from "@/lib/loja";

/**
 * Avisos da loja pro dono, do mais novo pro mais antigo. Invasão ainda não
 * lida vem sempre primeiro. As imagens não vêm aqui (são pesadas) — só
 * quantas são; o app busca em GET /api/dono/alertas/{id}.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (!(await lojaDoDono(id, auth.user.id)))
    return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  const [alertas, naoLidos, bloqueios] = await Promise.all([
    prisma.lojaAlerta.findMany({
      where: { lojaId: id },
      orderBy: { ocorridoEm: "desc" },
      take: 60,
      include: { _count: { select: { imagens: true } } },
    }),
    prisma.lojaAlerta.count({ where: { lojaId: id, lidoEm: null } }),
    prisma.lojaBloqueio.findMany({
      where: { lojaId: id, removidoEm: null },
      select: { user: { select: { codigoCliente: true } } },
    }),
  ]);
  const bloqueados = new Set(bloqueios.map((b) => b.user.codigoCliente));
  const urgente = (a: (typeof alertas)[number]) => (a.tipo === "INVASAO" && !a.lidoEm ? 0 : 1);

  return NextResponse.json({
    naoLidos,
    alertas: alertas
      .sort((a, b) => urgente(a) - urgente(b))
      .map((a) => ({
        id: a.id, tipo: a.tipo, titulo: a.titulo, detalhe: a.detalhe, ocorridoEm: a.ocorridoEm, lidoEm: a.lidoEm,
        imagens: a._count.imagens,
        codigoCliente: a.codigoCliente,
        clienteBloqueado: a.codigoCliente != null && bloqueados.has(a.codigoCliente),
      })),
  });
}

/** Marca TODOS os avisos da loja como lidos. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (!(await lojaDoDono(id, auth.user.id)))
    return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  await prisma.lojaAlerta.updateMany({ where: { lojaId: id, lidoEm: null }, data: { lidoEm: new Date() } });
  return NextResponse.json({ ok: true });
}
