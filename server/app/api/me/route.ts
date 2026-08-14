import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { user } = auth;
  return NextResponse.json({
    id: user.id, phone: user.phone, name: user.name, cpf: user.cpf,
    role: user.role, walletCents: user.walletCents,
  });
}

const Body = z.object({ name: z.string().min(2).max(80).optional(), cpf: z.string().regex(/^\d{11}$/).optional() });

export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const user = await prisma.user.update({ where: { id: auth.user.id }, data: parsed.data });
  return NextResponse.json({ ok: true, name: user.name, cpf: user.cpf });
}
