import { NextRequest, NextResponse } from "next/server";
import { buscarPorCodigo } from "@/lib/caixa";
import { lojaConfigurada } from "@/lib/config";

/** Caixa: procura um produto pelo código de barras lido. Sem login — quem
 *  chama é a tela do cliente; devolve só nome e preço de venda. */
export async function GET(req: NextRequest) {
  if (!(await lojaConfigurada())) return NextResponse.json({ error: "Loja não cadastrada" }, { status: 503 });
  return NextResponse.json(await buscarPorCodigo(req.nextUrl.searchParams.get("codigo") ?? ""));
}
