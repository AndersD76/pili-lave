import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { signToken } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { meComSolicitacoes } from "@/lib/meShape";

const Body = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string(),
});

const ERRO_GENERICO = "E-mail ou senha inválidos";

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: ERRO_GENERICO }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  // mesma mensagem para e-mail inexistente e senha errada — não vaza qual cadastro existe
  if (!user || !user.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash))
    return NextResponse.json({ error: ERRO_GENERICO }, { status: 401 });

  const token = await signToken({ id: user.id, phone: user.phone, role: user.role });
  return NextResponse.json({ token, user: await meComSolicitacoes(user) });
}
