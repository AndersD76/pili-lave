import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { signToken } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { hashPassword, validatePassword } from "@/lib/password";
import { meComSolicitacoes } from "@/lib/meShape";

const TIPO = z.enum(["LAVADOR", "COMISSAO1", "COMISSAO2", "ALUGUEL"]);

const Body = z
  .object({
    name: z.string().trim().min(2, "Informe seu nome completo").max(80),
    phone: z.string().min(8, "Telefone inválido"),
    email: z.string().trim().toLowerCase().email("E-mail inválido"),
    password: z.string(),
    confirmPassword: z.string(),
    // Pedidos opcionais pra virar Lavador e/ou Comissão1/Comissão2/Aluguel —
    // pode pedir mais de um ao mesmo tempo. Cada um fica pendente de
    // aprovação do admin, independente dos outros; continua CLIENT normal
    // até lá.
    tiposSolicitados: z.array(TIPO).max(4).optional(),
  })
  .refine((b) => b.password === b.confirmPassword, {
    message: "As senhas não são iguais",
    path: ["confirmPassword"],
  });

/**
 * Cadastro: substitui o login por SMS como porta de entrada do app (o
 * telefone ainda é guardado, só não serve mais para autenticar sozinho —
 * ver lib/otp.ts, mantido só por compatibilidade/legado).
 * Sucesso já devolve o token: o app loga automaticamente, sem 2º passo.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { name, email, password, tiposSolicitados } = parsed.data;

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "Telefone inválido" }, { status: 400 });

  const senhaErro = validatePassword(password);
  if (senhaErro) return NextResponse.json({ error: senhaErro }, { status: 400 });

  const [emailEmUso, telefoneEmUso] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.user.findUnique({ where: { phone } }),
  ]);
  if (emailEmUso) return NextResponse.json({ error: "Este e-mail já está cadastrado" }, { status: 409 });
  if (telefoneEmUso) return NextResponse.json({ error: "Este telefone já está cadastrado" }, { status: 409 });

  const tipos = [...new Set(tiposSolicitados ?? [])];
  const user = await prisma.user.create({
    data: {
      name, phone, email, passwordHash: hashPassword(password),
      solicitacoes: tipos.length > 0 ? { create: tipos.map((tipo) => ({ tipo })) } : undefined,
    },
  });
  await prisma.event.create({
    data: { type: "user_registered", payload: { userId: user.id, email, tiposSolicitados: tipos } },
  });

  const token = await signToken({ id: user.id, phone: user.phone, role: user.role });
  return NextResponse.json({ token, user: await meComSolicitacoes(user) }, { status: 201 });
}
