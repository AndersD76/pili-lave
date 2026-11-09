import { NextRequest, NextResponse } from "next/server";
import { requireUser, signTokenPagamentoLoja } from "@/lib/auth";

/**
 * O cliente logado pede um token pra mostrar como QR no caixa da loja. Dura
 * 3 minutos — a tela que mostra o QR pede um novo sozinha antes de vencer
 * (ver app/loja/pagar). Não precisa saber em qual loja: quem confere isso é
 * o caixa, pela própria conta dele.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const token = await signTokenPagamentoLoja(auth.user.id);
  return NextResponse.json({ token, duracaoSeg: 180 });
}
