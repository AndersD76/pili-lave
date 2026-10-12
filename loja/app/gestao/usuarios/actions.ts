"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { registrarAtividade } from "@/lib/atividade";
import { lerPermissoes, PERMISSOES, rotuloPermissao, type Permissao } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { exigirLojista, hashSenha, validarSenha } from "@/lib/sessao";

const BASE = "/gestao/usuarios";
const erro = (msg: string): never => redirect(`${BASE}?erro=${encodeURIComponent(msg)}`);

/** Permissões marcadas no formulário (um checkbox por permissão). */
function permissoesDoForm(formData: FormData): Permissao[] {
  return PERMISSOES.map((p) => p.chave).filter((chave) => formData.get(`perm_${chave}`) === "on");
}

function descrever(permissoes: Permissao[]): string {
  return permissoes.length === 0 ? "nenhuma permissão" : permissoes.map(rotuloPermissao).join(", ").toLowerCase();
}

/** Lojista cadastra um funcionário, com as permissões que marcar. */
export async function criarFuncionario(formData: FormData) {
  const { usuario } = await exigirLojista();
  const nome = String(formData.get("nome") ?? "").trim();
  const login = String(formData.get("login") ?? "").trim().toLowerCase();
  const senha = String(formData.get("senha") ?? "");

  if (nome.length < 2) erro("Informe o nome do funcionário.");
  // "@" é reservado: login com e-mail é o do lojista, conferido na nuvem
  if (!/^[a-z0-9._-]{3,30}$/.test(login))
    erro("O usuário tem de 3 a 30 caracteres: letras sem acento, números, ponto, traço ou sublinhado.");
  const erroSenha = validarSenha(senha);
  if (erroSenha) erro(erroSenha);
  if (await prisma.usuario.findUnique({ where: { login } })) erro(`Já existe um usuário "${login}".`);

  const permissoes = permissoesDoForm(formData);
  await prisma.$transaction(async (tx) => {
    await tx.usuario.create({
      data: { nome, login, senhaHash: hashSenha(senha), papel: "FUNCIONARIO", permissoes: JSON.stringify(permissoes) },
    });
    await registrarAtividade(tx, usuario, "USUARIO_CRIADO", `${nome} (${login}): ${descrever(permissoes)}`);
  });
  revalidatePath(BASE);
  redirect(`${BASE}?ok=1`);
}

/** Lojista altera um funcionário: nome, permissões, ativo e (opcional) senha nova. */
export async function salvarFuncionario(formData: FormData) {
  const { usuario } = await exigirLojista();
  const id = String(formData.get("id"));
  const alvo = await prisma.usuario.findUnique({ where: { id } });
  if (!alvo || alvo.papel !== "FUNCIONARIO") erro("Funcionário não encontrado.");
  const a = alvo!;

  const nome = String(formData.get("nome") ?? "").trim();
  if (nome.length < 2) erro("Informe o nome do funcionário.");
  const ativo = formData.get("ativo") === "on";
  const permissoes = permissoesDoForm(formData);
  const senha = String(formData.get("senha") ?? "");
  if (senha) {
    const erroSenha = validarSenha(senha);
    if (erroSenha) erro(erroSenha);
  }

  const antes = lerPermissoes(a.permissoes);
  const mudancas: string[] = [];
  if (nome !== a.nome) mudancas.push(`nome "${a.nome}" → "${nome}"`);
  if (ativo !== a.ativo) mudancas.push(ativo ? "reativado" : "desativado");
  const ganhou = permissoes.filter((p) => !antes.includes(p));
  const perdeu = antes.filter((p) => !permissoes.includes(p));
  if (ganhou.length) mudancas.push(`ganhou: ${descrever(ganhou)}`);
  if (perdeu.length) mudancas.push(`perdeu: ${descrever(perdeu)}`);
  if (senha) mudancas.push("senha trocada");
  if (mudancas.length === 0) redirect(BASE);

  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({
      where: { id },
      data: { nome, ativo, permissoes: JSON.stringify(permissoes), ...(senha ? { senhaHash: hashSenha(senha) } : {}) },
    });
    await registrarAtividade(tx, usuario, "USUARIO_ALTERADO", `${a.nome} (${a.login}): ${mudancas.join("; ")}`);
  });
  revalidatePath(BASE);
  redirect(`${BASE}?ok=1`);
}
