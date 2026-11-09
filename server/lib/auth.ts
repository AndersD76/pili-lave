import { SignJWT, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";

/* Fallback de teste: sem JWT_SECRET no ambiente, usa um fixo (trocar em produção). */
const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "pililave-teste-8512eff13d539f76");

export type SessionUser = { id: string; phone: string; role: "CLIENT" | "LAVADOR" | "PARCEIRO" | "ADMIN" };

export async function signToken(user: SessionUser): Promise<string> {
  return new SignJWT({ phone: user.phone, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("180d")
    .sign(secret);
}

export async function getSession(req: NextRequest): Promise<SessionUser | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(header.slice(7), secret);
    if (!payload.sub) return null;
    return { id: payload.sub, phone: String(payload.phone), role: payload.role as SessionUser["role"] };
  } catch {
    return null;
  }
}

/**
 * Token de pagamento na loja de conveniência: o cliente pede um (logado no
 * app) e mostra como QR no caixa. Curto de propósito (3 min) — é só pra dar
 * tempo de escanear e confirmar; não serve pra mais nada além de pagar.
 * `typ` separa esse token do de login: mesmo que alguém capture um QR
 * vencido, ele não vale como sessão do app.
 */
export async function signTokenPagamentoLoja(userId: string): Promise<string> {
  return new SignJWT({ typ: "loja-pagamento" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("3m")
    .sign(secret);
}

export async function verificarTokenPagamentoLoja(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.typ !== "loja-pagamento" || !payload.sub) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

/** Sessão obrigatória; opcionalmente restrita a um papel (checado no banco,
 *  para promoções via admin valerem sem o usuário precisar relogar). */
export async function requireUser(req: NextRequest, role?: "LAVADOR" | "PARCEIRO" | "ADMIN") {
  const session = await getSession(req);
  if (!session) return { error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return { error: NextResponse.json({ error: "Usuário não existe" }, { status: 401 }) };
  if (role && user.role !== role && user.role !== "ADMIN")
    return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  return { user };
}
