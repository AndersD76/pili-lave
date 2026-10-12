import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { meComSolicitacoes } from "@/lib/meShape";
import { parseNascimento } from "@/lib/nascimento";
import { TERMOS_TOPICOS, TERMOS_VERSAO } from "@/lib/termos";

/** Texto vigente do termo — o app nativo busca daqui (a PWA importa direto
 *  de lib/termos.ts), pra existir uma única fonte do texto. */
export async function GET() {
  return NextResponse.json({ versao: TERMOS_VERSAO, topicos: TERMOS_TOPICOS });
}

const Body = z.object({
  versao: z.string(),
  nascimento: z.string().optional(),
});

/**
 * Aceite do termo de uso — obrigatório pra usar o app. Quem se cadastrou
 * antes da data de nascimento existir informa ela aqui, na mesma tela.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  // a tela pode ter ficado aberta enquanto uma versão nova foi publicada
  if (parsed.data.versao !== TERMOS_VERSAO)
    return NextResponse.json({ error: "O termo foi atualizado. Recarregue a tela e leia a versão nova." }, { status: 409 });

  let nascimento = auth.user.nascimento;
  if (parsed.data.nascimento) {
    nascimento = parseNascimento(parsed.data.nascimento);
    if (!nascimento) return NextResponse.json({ error: "Data de nascimento inválida" }, { status: 400 });
  }
  if (!nascimento) return NextResponse.json({ error: "Informe sua data de nascimento" }, { status: 400 });

  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data: { termosVersao: TERMOS_VERSAO, termosAceitosEm: new Date(), nascimento },
  });
  await prisma.event.create({
    data: { type: "termos_aceitos", payload: { userId: user.id, versao: TERMOS_VERSAO } },
  });
  return NextResponse.json(await meComSolicitacoes(user));
}
