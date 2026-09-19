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

export async function definirOperador(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  const operadorId = String(formData.get("operadorId") || "");
  await prisma.machine.update({ where: { id }, data: { operadorId: operadorId || null } });
  revalidatePath("/admin/maquinas");
}

const TIPOS_PARTICIPACAO = ["LAVADOR", "COMISSAO1", "COMISSAO2", "ALUGUEL"] as const;

/**
 * Cria/atualiza o participante de um tipo numa máquina. Valida que a soma de
 * todos os participantes (incluindo esse, substituindo o valor antigo dele se
 * já existia) não passe de 100% — o resto fica pro admin, nunca guardado.
 */
export async function salvarParticipante(formData: FormData) {
  if (!(await isAdmin())) return;
  const machineId = String(formData.get("machineId"));
  const tipo = String(formData.get("tipo"));
  const userId = String(formData.get("userId") || "");
  const percentual = Number(formData.get("percentual"));

  if (!TIPOS_PARTICIPACAO.includes(tipo as (typeof TIPOS_PARTICIPACAO)[number])) return;
  if (!userId || !Number.isFinite(percentual) || percentual <= 0) return;

  const outros = await prisma.machineParticipante.findMany({
    where: { machineId, tipo: { not: tipo as (typeof TIPOS_PARTICIPACAO)[number] } },
  });
  const somaOutros = outros.reduce((s, p) => s + p.percentual, 0);
  const percentualFinal = Math.min(percentual, Math.max(0, 100 - somaOutros));
  if (percentualFinal <= 0) return;

  await prisma.machineParticipante.upsert({
    where: { machineId_tipo: { machineId, tipo: tipo as (typeof TIPOS_PARTICIPACAO)[number] } },
    update: { userId, percentual: percentualFinal },
    create: { machineId, tipo: tipo as (typeof TIPOS_PARTICIPACAO)[number], userId, percentual: percentualFinal },
  });
  revalidatePath("/admin/maquinas");
}

export async function removerParticipante(formData: FormData) {
  if (!(await isAdmin())) return;
  const machineId = String(formData.get("machineId"));
  const tipo = String(formData.get("tipo"));
  if (!TIPOS_PARTICIPACAO.includes(tipo as (typeof TIPOS_PARTICIPACAO)[number])) return;
  await prisma.machineParticipante.deleteMany({ where: { machineId, tipo: tipo as (typeof TIPOS_PARTICIPACAO)[number] } });
  revalidatePath("/admin/maquinas");
}
