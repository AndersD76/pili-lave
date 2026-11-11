import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { lojaDoDono } from "@/lib/loja";
import { indicadoresDaLoja, periodoDaUrl } from "@/lib/lojaIndicadores";

/** Indicadores da loja pro dono: ?de=AAAA-MM-DD&ate=AAAA-MM-DD (sem
 *  parâmetros = últimos 30 dias). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (!(await lojaDoDono(id, auth.user.id)))
    return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  const periodo = periodoDaUrl(req.nextUrl.searchParams);
  if (!periodo) return NextResponse.json({ error: "Período inválido" }, { status: 400 });

  return NextResponse.json(await indicadoresDaLoja(id, periodo));
}
