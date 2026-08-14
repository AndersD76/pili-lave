import { SignJWT, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

export type SessionUser = { id: string; phone: string; role: "CLIENT" | "LAVADOR" | "ADMIN" };

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

/** Sessão obrigatória; opcionalmente restrita a um papel. */
export async function requireUser(req: NextRequest, role?: "LAVADOR" | "ADMIN") {
  const session = await getSession(req);
  if (!session) return { error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  if (role && session.role !== role && session.role !== "ADMIN")
    return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return { error: NextResponse.json({ error: "Usuário não existe" }, { status: 401 }) };
  return { user };
}
