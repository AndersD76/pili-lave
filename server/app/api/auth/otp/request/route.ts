import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizePhone, requestOtp } from "@/lib/otp";

const Body = z.object({ phone: z.string().min(8) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Telefone inválido" }, { status: 400 });
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "Telefone inválido" }, { status: 400 });

  const result = await requestOtp(phone);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 429 });
  return NextResponse.json({ ok: true, phone });
}
