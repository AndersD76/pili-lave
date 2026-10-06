"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";

export async function marcarPagamento(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  await prisma.machine.update({ where: { id }, data: { lastPaymentDate: new Date() } });
  revalidatePath("/admin/maquinas");
}

export async function alternarManutencao(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  const machine = await prisma.machine.findUnique({ where: { id } });
  if (!machine) return;
  await prisma.machine.update({
    where: { id },
    data: { status: machine.status === "MAINTENANCE" ? "OFFLINE" : "MAINTENANCE" },
  });
  revalidatePath("/admin/maquinas");
}

export async function salvarAspirador(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  const habilitado = formData.get("habilitado") === "on";
  const precoStr = String(formData.get("preco") || "").trim().replace(",", ".");
  const duracaoStr = String(formData.get("duracaoMin") || "").trim();
  const precoCents = Math.round(Number(precoStr) * 100);
  const duracaoMin = Number(duracaoStr);

  if (habilitado && (!precoStr || !Number.isFinite(precoCents) || precoCents <= 0)) return;
  if (habilitado && (!duracaoStr || !Number.isFinite(duracaoMin) || duracaoMin <= 0)) return;

  await prisma.machine.update({
    where: { id },
    data: {
      vacuumEnabled: habilitado,
      vacuumPriceCents: habilitado ? precoCents : null,
      vacuumDurationMin: habilitado ? duracaoMin : null,
    },
  });
  revalidatePath("/admin/maquinas");
}

export async function definirOperador(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  const operadorId = String(formData.get("operadorId") || "");
  await prisma.machine.update({ where: { id }, data: { operadorId: operadorId || null } });
  revalidatePath("/admin/maquinas");
}

const TIPOS_PARTICIPACAO = ["LAVADOR", "COMISSAO1", "COMISSAO2", "ALUGUEL"] as const;

export type SalvarParticipanteState = { error: string } | null;

/**
 * Cria/atualiza o participante de um tipo numa máquina. Valida que a soma de
 * todos os participantes (incluindo esse, substituindo o valor antigo dele se
 * já existia) não passe de 100% — o resto fica pro admin, nunca guardado.
 * Usado via useActionState no client pra sempre dar feedback (nunca falha
 * em silêncio — antes disso um erro de validação simplesmente não salvava
 * nada e o admin não tinha como saber por quê).
 */
const ESCOPOS = ["LAVAGEM", "ASPIRADOR"] as const;

export async function salvarParticipante(
  _prev: SalvarParticipanteState,
  formData: FormData
): Promise<SalvarParticipanteState> {
  if (!(await isAdmin())) return { error: "Sessão de admin expirou — faça login de novo." };
  const machineId = String(formData.get("machineId"));
  const tipo = String(formData.get("tipo"));
  const escopoStr = String(formData.get("escopo") || "LAVAGEM");
  const userId = String(formData.get("userId") || "");
  const percentualStr = String(formData.get("percentual") || "").trim().replace(",", ".");
  const percentual = Number(percentualStr);

  if (!TIPOS_PARTICIPACAO.includes(tipo as (typeof TIPOS_PARTICIPACAO)[number])) {
    return { error: "Tipo de participação inválido." };
  }
  if (!ESCOPOS.includes(escopoStr as (typeof ESCOPOS)[number])) {
    return { error: "Escopo inválido." };
  }
  const escopo = escopoStr as (typeof ESCOPOS)[number];
  if (!userId) return { error: "Escolha uma pessoa." };
  if (!percentualStr || !Number.isFinite(percentual) || percentual <= 0) {
    return { error: "Informe um percentual maior que zero." };
  }

  // Teto de 100% é POR ESCOPO — lavagens e aspirador têm percentuais
  // independentes, não competem pelo mesmo total.
  const outros = await prisma.machineParticipante.findMany({
    where: { machineId, escopo, tipo: { not: tipo as (typeof TIPOS_PARTICIPACAO)[number] } },
  });
  const somaOutros = outros.reduce((s, p) => s + p.percentual, 0);
  const maxDisponivel = Math.max(0, 100 - somaOutros);
  if (percentual > maxDisponivel) {
    return {
      error: `Só sobram ${maxDisponivel.toFixed(1)}% pra esse tipo neste escopo (os outros participantes já somam ${somaOutros.toFixed(1)}%).`,
    };
  }

  await prisma.machineParticipante.upsert({
    where: { machineId_tipo_escopo: { machineId, tipo: tipo as (typeof TIPOS_PARTICIPACAO)[number], escopo } },
    update: { userId, percentual },
    create: { machineId, tipo: tipo as (typeof TIPOS_PARTICIPACAO)[number], escopo, userId, percentual },
  });
  revalidatePath("/admin/maquinas");
  return null;
}

export async function removerParticipante(formData: FormData) {
  if (!(await isAdmin())) return;
  const machineId = String(formData.get("machineId"));
  const tipo = String(formData.get("tipo"));
  const escopoStr = String(formData.get("escopo") || "LAVAGEM");
  if (!TIPOS_PARTICIPACAO.includes(tipo as (typeof TIPOS_PARTICIPACAO)[number])) return;
  if (!ESCOPOS.includes(escopoStr as (typeof ESCOPOS)[number])) return;
  await prisma.machineParticipante.deleteMany({
    where: { machineId, tipo: tipo as (typeof TIPOS_PARTICIPACAO)[number], escopo: escopoStr as (typeof ESCOPOS)[number] },
  });
  revalidatePath("/admin/maquinas");
}
