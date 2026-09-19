"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";

function centsFromForm(v: FormDataEntryValue | null): number {
  const n = Number(String(v ?? "0").replace(",", "."));
  return Math.max(0, Math.round(n * 100));
}

/** Atualiza o preço PADRÃO (modelo) de um tipo de lavagem — vale pra toda
 * unidade que não tiver um preço próprio cadastrado. */
export async function salvarPrecoPadrao(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = Number(formData.get("id"));
  const precoCents = centsFromForm(formData.get("preco"));
  await prisma.program.update({ where: { id }, data: { precoCents } });
  revalidatePath("/admin/precos");
  revalidatePath("/admin/maquinas");
}

/** Define (ou atualiza) o preço de um tipo de lavagem PARA UMA UNIDADE
 * específica — sobrepõe o padrão só ali. */
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

/** Remove o preço próprio da unidade — volta a usar o padrão. */
export async function removerPrecoUnidade(formData: FormData) {
  if (!(await isAdmin())) return;
  const stationId = String(formData.get("stationId"));
  const programId = Number(formData.get("programId"));
  await prisma.stationPrograma.deleteMany({ where: { stationId, programId } });
  revalidatePath("/admin/maquinas");
}
