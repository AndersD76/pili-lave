"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";

const PAPEIS_ATRIBUIVEIS = ["CLIENT", "LAVADOR", "PARCEIRO"] as const;

export async function definirPapel(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  const role = String(formData.get("role"));
  if (!PAPEIS_ATRIBUIVEIS.includes(role as (typeof PAPEIS_ATRIBUIVEIS)[number])) return;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role === "ADMIN") return;
  await prisma.user.update({ where: { id }, data: { role: role as (typeof PAPEIS_ATRIBUIVEIS)[number] } });
  revalidatePath("/admin/usuarios");
}

/** LAVADOR vira LAVADOR de verdade; qualquer outro tipo pedido (comissão
 *  1/2, aluguel) vira PARCEIRO — o tipo exato só importa por máquina, na
 *  hora de vincular em MachineParticipante (ver admin/maquinas). */
export async function aprovarCadastro(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || !user.cadastroPendente || !user.cadastroTipoSolicitado) return;
  const role = user.cadastroTipoSolicitado === "LAVADOR" ? "LAVADOR" : "PARCEIRO";
  await prisma.user.update({ where: { id }, data: { role, cadastroPendente: false } });
  revalidatePath("/admin/usuarios");
}

export async function rejeitarCadastro(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  await prisma.user.update({
    where: { id },
    data: { cadastroPendente: false, cadastroTipoSolicitado: null },
  });
  revalidatePath("/admin/usuarios");
}
