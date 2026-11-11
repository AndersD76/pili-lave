import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { conferirTokenLocal } from "@/lib/tokenLocal";
import { registrarEvento, TIPOS_EVENTO } from "@/lib/visao";

const Body = z.object({
  tipo: z.enum(TIPOS_EVENTO),
  zona: z.string().max(60).nullish(),
  delta: z.number().int().min(-999).max(999).optional(),
  visitasNaZona: z.array(z.string().max(60)).max(10).optional(),
  ambiguo: z.boolean().optional(),
  /** Caminhos de arquivo neste computador (JPEG pequeno). */
  imagens: z.array(z.string().max(500)).max(10).optional(),
  detalhe: z.string().max(300).nullish(),
  ocorridoEm: z.coerce.date().optional(),
});

/** Recebe um evento das câmeras (programa em visao/). Ver lib/visao.ts
 *  pra regra de atribuição e o fechamento por período. */
export async function POST(req: NextRequest) {
  if (!(await conferirTokenLocal(req))) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Evento inválido." }, { status: 400 });
  return NextResponse.json(await registrarEvento(parsed.data), { status: 201 });
}
