import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { creditTopup } from "@/lib/wallet";
import { getChargeStatus } from "@/lib/asaas";
import { sincronizarRepasse } from "@/lib/repasse";

/**
 * Webhook do Asaas. Configure no painel Asaas:
 *   URL: https://SEU_DOMINIO/api/asaas/webhook
 *   Token de autenticação: valor de ASAAS_WEBHOOK_TOKEN
 * Eventos: PAYMENT_RECEIVED e PAYMENT_CONFIRMED (recarga) e
 * TRANSFER_DONE, TRANSFER_FAILED, TRANSFER_CANCELLED (repasses).
 */
export async function POST(req: NextRequest) {
  /* Este endereço credita saldo real. Sem token configurado, qualquer um
   * que descobrisse a URL poderia inventar pagamentos e se dar crédito —
   * por isso aqui RECUSA em vez de aceitar. */
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
  if (!esperado) {
    console.error("[asaas] webhook recusado: ASAAS_WEBHOOK_TOKEN não configurado");
    return NextResponse.json({ error: "webhook não configurado" }, { status: 503 });
  }
  if (req.headers.get("asaas-access-token") !== esperado)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const event = body?.event as string | undefined;

  /* Repasse (PIX que nós mandamos): o status vem do próprio Asaas, não do
   * corpo do evento — o evento só avisa que algo mudou. */
  if (event?.startsWith("TRANSFER_")) {
    const transferId = body?.transfer?.id as string | undefined;
    const repasse = transferId
      ? await prisma.repasse.findUnique({ where: { asaasTransferId: transferId } })
      : null;
    if (repasse)
      await sincronizarRepasse(repasse.id).catch((e) => console.error("[asaas] sync repasse:", e));
    return NextResponse.json({ ok: true });
  }

  const paymentId = body?.payment?.id as string | undefined;
  if (!event || !paymentId) return NextResponse.json({ ok: true }); // ignora formatos inesperados

  if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") {
    const topup = await prisma.topup.findUnique({ where: { asaasPaymentId: paymentId } });
    if (topup) {
      /* Confere no próprio Asaas antes de creditar: o corpo do webhook vem
       * de fora e dinheiro não deve entrar só porque alguém disse que
       * entrou. creditTopup já é idempotente (ignora topup que não está
       * PENDING), então reenvio do Asaas não credita duas vezes. */
      const status = await getChargeStatus(paymentId).catch(() => null);
      if (status === "PAID") await creditTopup(topup.id);
      else console.error(`[asaas] webhook ${event} mas o pagamento ${paymentId} está ${status}`);
    }
  }
  return NextResponse.json({ ok: true });
}
