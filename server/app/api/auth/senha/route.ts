import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { hashPassword, validatePassword, verifyPassword } from "@/lib/password";

const Body = z.object({
  atual: z.string(),
  nova: z.string(),
});

/**
 * Troca de senha do próprio cliente. Exige a senha atual — sem isso, quem
 * pegasse o celular destravado trocaria a senha e tomaria a conta (com o
 * saldo junto). Não existe "esqueci minha senha" no app: se o cliente
 * perder, só o admin resolve.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: auth.user.id } });
  if (!user?.passwordHash)
    return NextResponse.json({ error: "Esta conta ainda não tem senha cadastrada." }, { status: 409 });

  if (!verifyPassword(parsed.data.atual, user.passwordHash))
    return NextResponse.json({ error: "Senha atual incorreta" }, { status: 401 });

  const erro = validatePassword(parsed.data.nova);
  if (erro) return NextResponse.json({ error: erro }, { status: 400 });

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(parsed.data.nova) },
  });
  return NextResponse.json({ ok: true });
}
