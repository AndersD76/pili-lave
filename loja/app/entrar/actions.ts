"use server";

import { redirect } from "next/navigation";
import { lerConfig } from "@/lib/config";
import { abrirSessao, conferirSenha, fecharSessao } from "@/lib/sessao";

export async function entrar(formData: FormData) {
  const guardada = await lerConfig("senhaHash");
  if (!guardada) redirect("/primeiro-uso");
  if (!conferirSenha(String(formData.get("senha") ?? ""), guardada)) redirect("/entrar?erro=1");
  await abrirSessao();
  redirect("/");
}

export async function sair() {
  await fecharSessao();
  redirect("/entrar");
}
