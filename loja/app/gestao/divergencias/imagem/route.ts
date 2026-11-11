import { readFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { lerLista } from "@/lib/alertas";
import { prisma } from "@/lib/prisma";
import { usuarioDaSessao } from "@/lib/sessao";

const TIPOS: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/** Mostra uma imagem de um evento das câmeras — só pro lojista logado. O
 *  caminho vem do banco (pelo id do evento), nunca do endereço da página. */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDaSessao();
  if (!usuario || usuario.papel !== "LOJISTA") return new NextResponse(null, { status: 401 });

  const evento = await prisma.eventoVisao.findUnique({ where: { id: req.nextUrl.searchParams.get("evento") ?? "" } });
  const caminho = evento ? lerLista(evento.imagens)[Number(req.nextUrl.searchParams.get("i") ?? 0)] : undefined;
  const tipo = caminho ? TIPOS[path.extname(caminho).toLowerCase()] : undefined;
  if (!caminho || !tipo) return new NextResponse(null, { status: 404 });
  try {
    return new NextResponse(new Uint8Array(await readFile(caminho)), { headers: { "Content-Type": tipo, "Cache-Control": "private, max-age=3600" } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
