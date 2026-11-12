import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { conferirTokenLocal } from "@/lib/tokenLocal";
import { registrarTrajeto } from "@/lib/trajetos";

const Body = z.object({
  divergenciaId: z.string().min(1).max(60),
  visitaId: z.string().min(1).max(60),
  resumo: z.string().max(600).default(""),
  /** Caminhos de arquivo neste computador: mapa do percurso e folhas de fotos. */
  imagens: z.array(z.string().max(500)).max(6).default([]),
});

/** O programa das câmeras devolve o trajeto de um suspeito. Sem imagens
 *  também vale (as câmeras não têm registro): o pedido é dado como atendido. */
export async function POST(req: NextRequest) {
  if (!(await conferirTokenLocal(req))) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Trajeto inválido." }, { status: 400 });
  const r = await registrarTrajeto(parsed.data);
  return NextResponse.json(r, { status: r.ok ? 201 : 404 });
}
