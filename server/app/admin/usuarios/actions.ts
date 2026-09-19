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

/**
 * Aprova UMA solicitação (não o usuário inteiro) — uma pessoa pode ter
 * várias pendentes ao mesmo tempo (ex: Lavador de uma máquina + Aluguel de
 * outra), cada uma aprovada/rejeitada independente. LAVADOR sempre "ganha"
 * de PARCEIRO no campo role (dá acesso ao scanner de vouchers); role nunca
 * é rebaixado por essa ação, só promovido.
 */
export async function aprovarSolicitacao(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  const solicitacao = await prisma.solicitacaoParceiro.findUnique({ where: { id }, include: { user: true } });
  if (!solicitacao || solicitacao.status !== "PENDENTE") return;

  const { user } = solicitacao;
  const novoRole =
    user.role === "ADMIN" || user.role === "LAVADOR"
      ? user.role
      : solicitacao.tipo === "LAVADOR"
      ? "LAVADOR"
      : "PARCEIRO";

  await prisma.$transaction([
    prisma.solicitacaoParceiro.update({ where: { id }, data: { status: "APROVADA", decididoEm: new Date() } }),
    prisma.user.update({ where: { id: user.id }, data: { role: novoRole } }),
  ]);
  revalidatePath("/admin/usuarios");
}

export async function rejeitarSolicitacao(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  await prisma.solicitacaoParceiro.update({
    where: { id },
    data: { status: "REJEITADA", decididoEm: new Date() },
  });
  revalidatePath("/admin/usuarios");
}
