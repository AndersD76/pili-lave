"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";

/** Campos comuns do formulário de loja (criar e editar usam o mesmo). */
async function dadosDaLoja(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return null;
  const capacidade = Math.min(50, Math.max(1, Math.round(Number(formData.get("capacidade")) || 3)));

  // Dono: só vale quem tem DONO_LOJA aprovado — o select só oferece esses,
  // mas o valor vem do navegador, então confere de novo aqui.
  const donoIdForm = String(formData.get("donoId") ?? "");
  let donoId: string | null = null;
  if (donoIdForm) {
    const aprovado = await prisma.solicitacaoParceiro.findFirst({
      where: { userId: donoIdForm, tipo: "DONO_LOJA", status: "APROVADA" },
    });
    if (aprovado) donoId = donoIdForm;
  }

  return {
    name,
    address: String(formData.get("address") ?? "").trim(),
    city: String(formData.get("city") ?? "").trim(),
    state: String(formData.get("state") ?? "RS").trim().toUpperCase().slice(0, 2) || "RS",
    capacidade,
    donoId,
  };
}

export async function criarLoja(formData: FormData) {
  if (!(await isAdmin())) return;
  const data = await dadosDaLoja(formData);
  if (!data) return;
  await prisma.loja.create({ data });
  revalidatePath("/admin/lojas");
}

export async function salvarLoja(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  const data = await dadosDaLoja(formData);
  if (!data) return;
  await prisma.loja.update({ where: { id }, data: { ...data, active: formData.get("active") === "on" } });
  revalidatePath("/admin/lojas");
}
