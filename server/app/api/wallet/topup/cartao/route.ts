import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { asaasConfigurado, cobrarNoCartao } from "@/lib/asaas";
import { creditTopup } from "@/lib/wallet";

const MIN_CENTS = 1000;      // R$ 10
const MAX_CENTS = 100000;    // R$ 1.000

const Body = z.object({
  amountCents: z.number().int().min(MIN_CENTS).max(MAX_CENTS),
  tipo: z.enum(["CREDITO", "DEBITO"]).default("CREDITO"),
  cartao: z.object({
    numero: z.string().min(13),
    nome: z.string().min(2),
    mes: z.string().regex(/^(0[1-9]|1[0-2])$/),
    ano: z.string().regex(/^20\d{2}$/),
    cvv: z.string().regex(/^\d{3,4}$/),
    cpfCnpj: z.string().min(11),
    cep: z.string().min(8),
    numeroEndereco: z.string().min(1),
    email: z.string().email().optional(),
    telefone: z.string().optional(),
  }),
});

/**
 * Recarga no CARTÃO — crédito à vista ou débito — sem sair do app.
 *
 * Os dados do cartão passam por aqui e vão direto ao Asaas: NADA é gravado
 * no nosso banco (nem número, nem CVV). O que fica é só o id da cobrança.
 * Aprovou na hora, o saldo entra na hora; ficou em análise, o webhook
 * credita quando o Asaas confirmar.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Dados do cartão incompletos ou inválidos." }, { status: 400 });

  if (!asaasConfigurado())
    return NextResponse.json(
      { error: "Pagamento indisponível no momento. Fale com o atendimento.", indisponivel: true },
      { status: 503 }
    );

  const { amountCents, tipo, cartao } = parsed.data;
  // o Asaas exige o IP de quem paga para a análise antifraude
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;

  try {
    const cobranca = await cobrarNoCartao(auth.user.id, amountCents, cartao, tipo, ip);

    const topup = await prisma.topup.create({
      data: {
        userId: auth.user.id,
        amountCents,
        method: "CARD",
        asaasPaymentId: cobranca.paymentId,
      },
    });

    // aprovado na hora: credita já, sem esperar o webhook
    if (cobranca.status === "PAID") {
      await creditTopup(topup.id);
      return NextResponse.json({ id: topup.id, status: "PAID", saldoCreditado: true }, { status: 201 });
    }
    if (cobranca.status === "PENDING")
      return NextResponse.json(
        { id: topup.id, status: "PENDING", aviso: "Pagamento em análise. O saldo entra assim que for aprovado." },
        { status: 201 }
      );

    return NextResponse.json({ error: "Pagamento recusado pelo banco emissor." }, { status: 402 });
  } catch (e) {
    // CPF é exigência do Asaas, não nossa — explica em vez de "erro genérico"
    if (e instanceof Error && e.message === "FALTA_CPF")
      return NextResponse.json(
        { error: "Informe seu CPF no perfil para poder adicionar saldo.", faltaCpf: true },
        { status: 400 }
      );
    const msg = e instanceof Error ? e.message : "Não foi possível cobrar o cartão";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
