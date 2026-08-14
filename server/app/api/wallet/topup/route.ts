import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { createCharge } from "@/lib/asaas";

const MIN_CENTS = 1000;      // R$ 10
const MAX_CENTS = 100000;    // R$ 1.000

const Body = z.object({
  amountCents: z.number().int().min(MIN_CENTS).max(MAX_CENTS),
  method: z.enum(["PIX", "CARD"]),
});

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Valor inválido (mín. R$ 10, máx. R$ 1.000)" }, { status: 400 });

  try {
    const charge = await createCharge(auth.user.id, parsed.data.amountCents, parsed.data.method);
    const topup = await prisma.topup.create({
      data: {
        userId: auth.user.id,
        amountCents: parsed.data.amountCents,
        method: parsed.data.method,
        asaasPaymentId: charge.paymentId,
        pixPayload: charge.pixPayload,
        invoiceUrl: charge.invoiceUrl,
      },
    });
    return NextResponse.json({
      id: topup.id,
      pixPayload: topup.pixPayload,
      invoiceUrl: topup.invoiceUrl,
      status: topup.status,
    }, { status: 201 });
  } catch (e) {
    console.error("Topup falhou:", e);
    return NextResponse.json({ error: "Não foi possível criar a cobrança. Tente novamente." }, { status: 502 });
  }
}
