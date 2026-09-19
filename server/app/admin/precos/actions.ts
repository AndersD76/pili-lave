"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";

function centsFromForm(v: FormDataEntryValue | null): number {
  const n = Number(String(v ?? "0").replace(",", "."));
  return Math.max(0, Math.round(n * 100));
}

/** Nome do tipo de lavagem (vale pra todas as unidades) — não tem preço
 * aqui, só na aba de cada unidade. */
export async function salvarNomeTipo(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = Number(formData.get("id"));
  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) return;
  await prisma.program.update({ where: { id }, data: { nome } });
  revalidatePath("/admin/precos");
  revalidatePath("/admin/maquinas");
}

/** Define (ou atualiza) o preço de um tipo de lavagem NESTA unidade —
 * cada unidade preenche o próprio valor, sem herdar de lugar nenhum. */
export async function salvarPrecoUnidade(formData: FormData) {
  if (!(await isAdmin())) return;
  const stationId = String(formData.get("stationId"));
  const programId = Number(formData.get("programId"));
  const precoCents = centsFromForm(formData.get("preco"));
  await prisma.stationPrograma.upsert({
    where: { stationId_programId: { stationId, programId } },
    update: { precoCents },
    create: { stationId, programId, precoCents },
  });
  revalidatePath("/admin/maquinas");
}
