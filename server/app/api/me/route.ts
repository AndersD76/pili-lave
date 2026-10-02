import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { meComSolicitacoes } from "@/lib/meShape";
import { atualizarCpfNoAsaas } from "@/lib/asaas";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  return NextResponse.json(await meComSolicitacoes(auth.user));
}

const Body = z.object({
  name: z.string().min(2).max(80).optional(),
  cpf: z.string().regex(/^\d{11}$/).optional(),
  /* Chave PIX de quem RECEBE (lavador, comissionado, aluguel). String vazia
   * limpa a chave — é como a pessoa remove o dado se quiser. */
  pixChave: z.string().max(120).optional(),
  pixTipo: z.enum(["CPF", "CNPJ", "EMAIL", "PHONE", "EVP"]).optional(),
});

export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const user = await prisma.user.update({ where: { id: auth.user.id }, data: parsed.data });

  /* CPF novo com customer já existente no Asaas: leva o CPF para lá. Se a
   * atualização falhar, esquece o customer — a próxima recarga cria outro,
   * já com CPF. Sem isso, quem preencheu o CPF depois continuaria sem
   * conseguir recarregar. */
  const cpfMudou = parsed.data.cpf && parsed.data.cpf !== auth.user.cpf;
  if (cpfMudou && user.asaasCustomerId) {
    try {
      await atualizarCpfNoAsaas(user.asaasCustomerId, parsed.data.cpf!);
    } catch {
      await prisma.user.update({ where: { id: user.id }, data: { asaasCustomerId: null } });
    }
  }
  return NextResponse.json({ ok: true, name: user.name, cpf: user.cpf });
}
