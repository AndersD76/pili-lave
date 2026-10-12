"use server";

import { redirect } from "next/navigation";
import { registrarAtividade } from "@/lib/atividade";
import { lerConfig, lojaConfigurada, NUVEM_URL } from "@/lib/config";
import { loginDono } from "@/lib/nuvem";
import { prisma } from "@/lib/prisma";
import { abrirSessao, conferirSenha, fecharSessao, hashSenha } from "@/lib/sessao";

async function concluir(usuario: { id: string; nome: string }, comoEntrou: string): Promise<never> {
  await registrarAtividade(prisma, usuario, "ENTROU", comoEntrou);
  await abrirSessao(usuario.id);
  redirect("/gestao");
}

/**
 * Entrada na gestão. Dois tipos de usuário, no mesmo formulário:
 *  - FUNCIONÁRIO: usuário e senha cadastrados aqui pelo lojista.
 *  - LOJISTA: o e-mail e a senha do app. Com internet, quem confere é a
 *    nuvem (é lá que o admin define quem é o dono desta loja) e a senha fica
 *    copiada aqui; sem internet, vale essa cópia.
 */
export async function entrar(formData: FormData) {
  if (!(await lojaConfigurada())) redirect("/primeiro-uso");
  const login = String(formData.get("usuario") ?? "").trim().toLowerCase();
  const senha = String(formData.get("senha") ?? "");
  if (!login || !senha) redirect("/entrar?erro=dados");

  const local = await prisma.usuario.findUnique({ where: { login } });

  if (local?.papel === "FUNCIONARIO") {
    if (!local.ativo || !conferirSenha(senha, local.senhaHash)) redirect("/entrar?erro=dados");
    await concluir(local, "Funcionário");
  }

  // Não é funcionário: só pode ser o lojista, e o login dele é um e-mail.
  if (!login.includes("@")) redirect("/entrar?erro=dados");
  const deviceKey = await lerConfig("deviceKey");
  const r = await loginDono(NUVEM_URL, deviceKey ?? "", login, senha);

  if (r.situacao === "OK") {
    const dados = { nome: r.dono.nome, login: r.dono.email, senhaHash: hashSenha(senha), papel: "LOJISTA", ativo: true };
    const lojista = await prisma.$transaction(async (tx) => {
      // O dono pode ter sido trocado pelo admin: quem era lojista antes
      // perde o acesso neste computador.
      await tx.usuario.updateMany({
        where: { papel: "LOJISTA", nuvemUserId: { not: r.dono.id } },
        data: { ativo: false },
      });
      return tx.usuario.upsert({
        where: { nuvemUserId: r.dono.id },
        update: dados,
        create: { ...dados, nuvemUserId: r.dono.id },
      });
    });
    await concluir(lojista, "Lojista (conferido na nuvem)");
  }

  if (r.situacao === "SEM_CONEXAO") {
    // Sem internet: vale a senha copiada no último login conferido.
    if (local?.papel === "LOJISTA" && local.ativo && conferirSenha(senha, local.senhaHash))
      await concluir(local, "Lojista (sem internet)");
    redirect("/entrar?erro=conexao");
  }

  redirect(r.situacao === "NAO_E_DONO" ? "/entrar?erro=dono" : "/entrar?erro=dados");
}

export async function sair() {
  await fecharSessao();
  redirect("/");
}
