import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizePhone, verifyOtp } from "@/lib/otp";
import { signToken } from "@/lib/auth";

const Body = z.object({ phone: z.string().min(8), code: z.string().length(6) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "Telefone inválido" }, { status: 400 });

  const ok = await verifyOtp(phone, parsed.data.code);
  if (!ok) return NextResponse.json({ error: "Código incorreto ou expirado" }, { status: 401 });

  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    user = await prisma.user.create({ data: { phone } });
    await prisma.event.create({ data: { type: "user_created", payload: { userId: user.id, phone } } });
  }
  const token = await signToken({ id: user.id, phone: user.phone, role: user.role });
  return NextResponse.json({
    token,
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role, walletCents: user.walletCents },
  });
}
