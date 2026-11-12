import { NextRequest, NextResponse } from "next/server";
import { conferirTokenLocal } from "@/lib/tokenLocal";
import { pedidosDeTrajeto } from "@/lib/trajetos";

/** O programa das câmeras pergunta: de quem preciso montar o trajeto?
 *  (suspeitos de divergência com item faltando — ver lib/trajetos.ts) */
export async function GET(req: NextRequest) {
  if (!(await conferirTokenLocal(req))) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  return NextResponse.json(await pedidosDeTrajeto());
}
