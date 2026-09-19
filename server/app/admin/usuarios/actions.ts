"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";

const TIPOS_PARCEIRO = ["COMISSAO1", "COMISSAO2", "ALUGUEL"] as const;

/**
 * Atalho do admin pra promover alguém direto, sem esperar ela pedir pelo
 * app — útil pra quem já sabe que vai contratar/dar comissão a alguém.
 * "role" vem como "CLIENT", "LAVADOR" ou "PARCEIRO:<tipo>" (Comissão 1/2 ou
 * Aluguel) — no caso de Parceiro, cria/atualiza a SolicitacaoParceiro
 * correspondente já como APROVADA, senão a pessoa virava "Parceiro" sem
 * nenhum tipo visível em lugar nenhum.
 */
export async function definirPapel(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  const valor = String(formData.get("role"));
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role === "ADMIN") return;

  if (valor === "CLIENT") {
    await prisma.user.update({ where: { id }, data: { role: "CLIENT" } });
    revalidatePath("/admin/usuarios");
    return;
  }

  if (valor === "LAVADOR") {
    // Mesma lógica do Parceiro: registra a solicitação já aprovada, senão
    // o perfil da pessoa continua mostrando "Pedir" pro Lavador mesmo com
    // o role já promovido — inconsistente com o que aparece pra ela.
    await prisma.$transaction([
      prisma.solicitacaoParceiro.upsert({
        where: { userId_tipo: { userId: id, tipo: "LAVADOR" } },
        update: { status: "APROVADA", decididoEm: new Date() },
        create: { userId: id, tipo: "LAVADOR", status: "APROVADA", decididoEm: new Date() },
      }),
      prisma.user.update({ where: { id }, data: { role: "LAVADOR" } }),
    ]);
    revalidatePath("/admin/usuarios");
    return;
  }

  const [papel, tipo] = valor.split(":");
  if (papel !== "PARCEIRO" || !TIPOS_PARCEIRO.includes(tipo as (typeof TIPOS_PARCEIRO)[number])) return;

  await prisma.$transaction([
    prisma.solicitacaoParceiro.upsert({
      where: { userId_tipo: { userId: id, tipo: tipo as (typeof TIPOS_PARCEIRO)[number] } },
      update: { status: "APROVADA", decididoEm: new Date() },
      create: { userId: id, tipo: tipo as (typeof TIPOS_PARCEIRO)[number], status: "APROVADA", decididoEm: new Date() },
    }),
    // LAVADOR continua "acima" de Parceiro (já tem acesso ao scanner) — não rebaixa.
    prisma.user.update({ where: { id }, data: { role: user.role === "LAVADOR" ? "LAVADOR" : "PARCEIRO" } }),
  ]);
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
