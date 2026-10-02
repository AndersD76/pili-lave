"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { adminOpen, isAdmin } from "@/lib/admin";
import { pagarParticipante, saldosAPagar } from "@/lib/repasse";

export type PagarState = { ok: string } | { error: string } | null;

const LABEL_TIPO: Record<string, string> = {
  LAVADOR: "Lavador",
  COMISSAO1: "Comissão 1",
  COMISSAO2: "Comissão 2",
  ALUGUEL: "Aluguel",
};

function money(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

/** "1.234,56" ou "1234.56" -> centavos. Vírgula manda: com ela, ponto é milhar. */
function paraCentavos(txt: string): number | null {
  let t = txt.trim().replace(/[R$\s]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/* Um pagamento por pessoa de cada vez: dois cliques (ou duas abas) não
 * podem ler o mesmo saldo e pagar duas vezes. */
const emAndamento = new Set<string>();

/**
 * Paga a parte do app de um participante via PIX (Asaas). Dinheiro real:
 * só com painel protegido por senha, nunca acima do saldo devido.
 */
export async function pagar(_prev: PagarState, formData: FormData): Promise<PagarState> {
  if (!(await isAdmin())) return { error: "Sessão de admin expirou — faça login de novo." };
  if (adminOpen())
    return { error: "Painel sem senha (ADMIN_PASSWORD não configurada) — pagamentos bloqueados." };

  const userId = String(formData.get("userId") || "");
  const valorCents = paraCentavos(String(formData.get("valor") || ""));
  if (!valorCents) return { error: "Valor inválido." };
  if (emAndamento.has(userId)) return { error: "Já existe um pagamento em andamento para esta pessoa." };

  emAndamento.add(userId);
  try {
    const saldo = (await saldosAPagar()).find((s) => s.userId === userId);
    if (!saldo) return { error: "Participante não encontrado." };
    if (valorCents > saldo.aPagarCents)
      return { error: `Valor maior que o saldo a pagar (${money(saldo.aPagarCents)}).` };

    const recente = await prisma.repasse.findFirst({
      where: {
        userId,
        valorCents,
        status: { not: "FALHOU" },
        criadoEm: { gte: new Date(Date.now() - 2 * 60_000) },
      },
    });
    if (recente)
      return { error: "Um pagamento igual acabou de ser feito. Confira o histórico antes de repetir." };

    const tipos = [...new Set(saldo.vinculos.map((v) => LABEL_TIPO[v.tipo] ?? v.tipo))].join(", ");
    const r = await pagarParticipante(userId, valorCents, `PILI CLEAN - repasse (${tipos})`);
    if (!r.ok) return { error: r.erro };

    revalidatePath("/admin/repasses");
    return { ok: `${money(valorCents)} enviado para ${saldo.nome}. O Asaas confirma em instantes.` };
  } finally {
    emAndamento.delete(userId);
  }
}
