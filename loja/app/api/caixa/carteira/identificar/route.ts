import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { lerConfig, lojaConfigurada, NUVEM_URL } from "@/lib/config";
import { identificarCarteira } from "@/lib/nuvem";

const Body = z.object({ token: z.string().min(10) });

/**
 * Caixa escaneou o QR de pagamento do cliente (prefixo "PILILOJA:" tirado
 * pela tela): pergunta à nuvem quem é e qual o saldo, pra mostrar "Pagando:
 * Fulano — saldo R$ X" antes de cobrar de verdade.
 */
export async function POST(req: NextRequest) {
  if (!(await lojaConfigurada())) return NextResponse.json({ error: "Loja não cadastrada" }, { status: 503 });
  const deviceKey = await lerConfig("deviceKey");
  if (!deviceKey) return NextResponse.json({ error: "Loja não cadastrada" }, { status: 503 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ situacao: "ERRO", mensagem: "QR inválido." }, { status: 400 });

  const r = await identificarCarteira(NUVEM_URL, deviceKey, parsed.data.token);
  return NextResponse.json(r);
}
