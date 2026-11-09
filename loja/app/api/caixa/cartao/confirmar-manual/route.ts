import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { maquininha } from "@/lib/maquininha";
import { confirmarManual } from "@/lib/maquininha/manual";

const Body = z.object({ operacaoId: z.string().min(1), aprovado: z.boolean() });

/**
 * Só existe pro driver manual: é o clique do operador no visor da
 * maquininha física, "aprovado" ou "recusado". Com um driver de verdade
 * (`maquininha.confirmacaoManual === false`) esta rota não é chamada — a
 * própria máquina resolve pelo lib/maquininha ativo, e o caixa só consulta
 * /status até sair de AGUARDANDO.
 */
export async function POST(req: NextRequest) {
  if (!maquininha.confirmacaoManual)
    return NextResponse.json({ erro: "A maquininha atual confirma sozinha — não use esta rota." }, { status: 409 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos." }, { status: 400 });
  return NextResponse.json(await confirmarManual(parsed.data.operacaoId, parsed.data.aprovado));
}
