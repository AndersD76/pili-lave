import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { conferirTokenLocal } from "@/lib/tokenLocal";
import { autorizarEntrada, ORIGENS } from "@/lib/visitas";

const Body = z
  .object({
    nuvemUserId: z.string().min(1).optional(),
    codigoCliente: z.union([z.string(), z.number()]).transform(String).optional(),
    criancas: z.number().int().min(0).max(2).optional(),
    origem: z.enum(ORIGENS),
    nome: z.string().trim().min(1).max(80).optional(),
  })
  .refine((b) => b.nuvemUserId || b.codigoCliente || b.nome, "Informe o cliente.");

/**
 * Pergunta do equipamento da porta (catraca, trava por BLE): "esta pessoa
 * pode entrar agora?". A resposta já traz a mensagem pra mostrar. Liberado
 * = a visita foi aberta; o equipamento deve chamar /api/entrada/saida
 * quando a pessoa sair.
 */
export async function POST(req: NextRequest) {
  if (!(await conferirTokenLocal(req))) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  return NextResponse.json(await autorizarEntrada(parsed.data));
}
