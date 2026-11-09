import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verificarTokenPagamentoLoja } from "@/lib/auth";
import { lojaPorDeviceKey } from "@/lib/loja";
import { prisma } from "@/lib/prisma";

const Body = z.object({ token: z.string().min(10) });

/**
 * Caixa escaneou o QR do cliente (ver app/loja/pagar): confere o token e
 * devolve nome + saldo, pra mostrar "Pagando: Fulano — saldo R$ X" antes de
 * cobrar de verdade. Não debita nada — é só a identificação (POST /debitar
 * confere o token de novo).
 */
export async function POST(req: NextRequest) {
  const loja = await lojaPorDeviceKey(req);
  if (!loja) return NextResponse.json({ error: "Computador não cadastrado" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "QR inválido" }, { status: 400 });

  const userId = await verificarTokenPagamentoLoja(parsed.data.token);
  if (!userId) return NextResponse.json({ error: "QR expirado. Peça pro cliente abrir a tela de novo." }, { status: 410 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, walletCents: true } });
  if (!user) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  return NextResponse.json({ userId: user.id, nome: user.name ?? "Cliente", walletCents: user.walletCents });
}
