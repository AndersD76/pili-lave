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
