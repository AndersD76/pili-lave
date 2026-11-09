import { NextRequest, NextResponse } from "next/server";
import { maquininha } from "@/lib/maquininha";

/** Caixa consulta, a cada poucos segundos, como está indo a cobrança. */
export async function GET(req: NextRequest) {
  const operacaoId = req.nextUrl.searchParams.get("operacaoId");
  if (!operacaoId) return NextResponse.json({ situacao: "RECUSADO", motivo: "Operação inválida." }, { status: 400 });
  return NextResponse.json(await maquininha.consultar(operacaoId));
}
