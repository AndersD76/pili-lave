import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Validação de saque do Asaas. Antes de deixar sair dinheiro da conta, o
 * Asaas pergunta aqui se a operação é legítima. É a defesa contra alguém
 * que roube a chave da API: mesmo com a chave, o saque não sai sem o nosso
 * "sim".
 *
 * Regra: aprova só o que o PRÓPRIO SISTEMA originou — todo pagamento que
 * fazemos cria um Repasse antes de chamar o Asaas. Saque sem Repasse
 * correspondente, ou com valor diferente do registrado, é recusado.
 *
 * Configurar no painel Asaas (Segurança → Validação de saque via Webhook):
 *   URL: https://SEU_DOMINIO/api/asaas/saque
 *   Token: o mesmo valor de ASAAS_WEBHOOK_TOKEN
 *
 * O Asaas tenta 3 vezes; sem resposta válida, ele CANCELA a operação —
 * ou seja, falhar aqui é seguro (não libera dinheiro por engano).
 */

function recusar(motivo: string) {
  console.error(`[asaas/saque] RECUSADO: ${motivo}`);
  return NextResponse.json({ status: "REFUSED", refuseReason: motivo });
}

export async function POST(req: NextRequest) {
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
  if (!esperado) return recusar("validação não configurada no servidor");
  if (req.headers.get("asaas-access-token") !== esperado)
    return recusar("token inválido");

  const body = await req.json().catch(() => null);
  const tipo = body?.type as string | undefined;

  /* Só sabemos autorizar TRANSFER (nossos pagamentos de comissão/aluguel).
   * Qualquer outro tipo de saída — boleto, recarga de celular, split,
   * estorno PIX — não é originado por nós, então é recusado. */
  if (tipo !== "TRANSFER") return recusar(`tipo de operação não autorizado (${tipo ?? "desconhecido"})`);

  const t = body?.transfer as { id?: string; value?: number } | undefined;
  if (!t?.id) return recusar("transferência sem id");

  const repasse = await prisma.repasse.findUnique({ where: { asaasTransferId: t.id } });
  if (!repasse) return recusar("saque não foi originado pelo sistema");
  if (repasse.status === "CONCLUIDO" || repasse.status === "APROVADO")
    return recusar("este repasse já foi autorizado");

  // o valor tem de bater com o que registramos — centavo por centavo
  const valorRecebido = Math.round(Number(t.value ?? 0) * 100);
  if (valorRecebido !== repasse.valorCents)
    return recusar(`valor divergente (pedido ${repasse.valorCents}, recebido ${valorRecebido})`);

  await prisma.repasse.update({ where: { id: repasse.id }, data: { status: "APROVADO" } });
  await prisma.event.create({
    data: {
      type: "saque_autorizado",
      payload: { repasseId: repasse.id, asaasTransferId: t.id, valorCents: repasse.valorCents },
    },
  });
  return NextResponse.json({ status: "APPROVED" });
}
