import { NextResponse } from "next/server";
import { NUVEM_URL } from "@/lib/config";
import { nuvemAlcancavel } from "@/lib/nuvem";

/** O caixa pergunta isto antes de oferecer "Carteira do app" — sem internet,
 *  só dá pra pagar no cartão (a maquininha física não depende da nuvem). */
export async function GET() {
  return NextResponse.json({ conectado: await nuvemAlcancavel(NUVEM_URL) });
}
