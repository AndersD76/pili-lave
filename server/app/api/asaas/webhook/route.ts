import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { creditTopup } from "@/lib/wallet";

/**
 * Webhook do Asaas. Configure no painel Asaas:
 *   URL: https://SEU_DOMINIO/api/asaas/webhook
 *   Token de autenticação: valor de ASAAS_WEBHOOK_TOKEN
 * Eventos: PAYMENT_RECEIVED e PAYMENT_CONFIRMED.
 */
export async function POST(req: NextRequest) {
  // FASE DE TESTE: sem ASAAS_WEBHOOK_TOKEN no ambiente, aceita sem validar.
  if (process.env.ASAAS_WEBHOOK_TOKEN) {
    const token = req.headers.get("asaas-access-token");
    if (token !== process.env.ASAAS_WEBHOOK_TOKEN)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const event = body?.event as string | undefined;
  const paymentId = body?.payment?.id as string | undefined;
  if (!event || !paymentId) return NextResponse.json({ ok: true }); // ignora formatos inesperados

  if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") {
    const topup = await prisma.topup.findUnique({ where: { asaasPaymentId: paymentId } });
    if (topup) await creditTopup(topup.id);
  }
  return NextResponse.json({ ok: true });
}
