import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const Body = z.object({ tipo: z.enum(["LAVADOR", "COMISSAO1", "COMISSAO2", "ALUGUEL"]) });

/**
 * Pedido pra virar Lavador/Comissão1/Comissão2/Aluguel feito DEPOIS do
 * cadastro — qualquer cliente já logado pode pedir, a qualquer momento (não
 * só na hora de criar a conta). Fica PENDENTE até o admin aprovar/rejeitar
 * em /admin/usuarios. Pedir de novo depois de uma rejeição reabre a mesma
 * solicitação (volta pra PENDENTE) em vez de duplicar.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  const { tipo } = parsed.data;

  const existente = await prisma.solicitacaoParceiro.findUnique({
    where: { userId_tipo: { userId: auth.user.id, tipo } },
  });
  if (existente?.status === "APROVADA") {
    return NextResponse.json({ error: "Você já foi aprovado pra esse tipo" }, { status: 409 });
  }
  if (existente?.status === "PENDENTE") {
    return NextResponse.json({ error: "Já tem um pedido em análise pra esse tipo" }, { status: 409 });
  }

  await prisma.solicitacaoParceiro.upsert({
    where: { userId_tipo: { userId: auth.user.id, tipo } },
    update: { status: "PENDENTE", decididoEm: null },
    create: { userId: auth.user.id, tipo },
  });
  return NextResponse.json({ ok: true });
}
