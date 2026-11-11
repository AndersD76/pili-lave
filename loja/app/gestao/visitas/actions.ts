"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { registrarAtividade } from "@/lib/atividade";
import { porta } from "@/lib/porta";
import { prisma } from "@/lib/prisma";
import { exigirLojista, exigirPermissao } from "@/lib/sessao";
import { encerrarReposicao, iniciarReposicao, registrarSaida } from "@/lib/visitas";

const BASE = "/gestao/visitas";

function voltar(erro?: string, ok?: string): never {
  revalidatePath(BASE);
  redirect(erro ? `${BASE}?erro=${encodeURIComponent(erro)}` : `${BASE}?ok=${ok ?? "1"}`);
}

export async function iniciarReposicaoAction() {
  const { usuario } = await exigirPermissao("REPOSICAO");
  const r = await iniciarReposicao(usuario);
  voltar(r.ok ? undefined : r.erro, "reposicao-iniciada");
}

export async function encerrarReposicaoAction() {
  const { usuario } = await exigirPermissao("REPOSICAO");
  const r = await encerrarReposicao(usuario);
  voltar(r.ok ? undefined : r.erro, "reposicao-encerrada");
}

/** Saída que o equipamento não registrou (a pessoa já foi embora): só o
 *  lojista encerra à mão, sem gerar aviso de saída sem pagar. */
export async function registrarSaidaAction(formData: FormData) {
  const { usuario } = await exigirLojista();
  const visitaId = String(formData.get("visitaId") ?? "");
  const visita = await prisma.visita.findUnique({ where: { id: visitaId } });
  if (!visita || visita.saiuEm) voltar("Visita não encontrada ou já encerrada.");
  const r = await registrarSaida({ visitaId }, { silenciosa: true });
  if (!r.ok) voltar(r.erro);
  await registrarAtividade(prisma, usuario, "SAIDA_MANUAL", `Encerrou à mão a visita de ${visita.nome}.`);
  voltar(undefined, "saida");
}

/** Abre a porta daqui (entregador, cliente que precisa voltar) — só o lojista. */
export async function abrirPortaAction(formData: FormData) {
  const { usuario } = await exigirLojista();
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!motivo) voltar("Informe o motivo da abertura.");
  const r = await porta.abrir(`${usuario.nome}: ${motivo}`);
  await registrarAtividade(prisma, usuario, "PORTA_ABERTA", `${motivo}${r.ok ? "" : ` — FALHOU: ${r.erro}`}`);
  voltar(r.ok ? undefined : `A porta não abriu: ${r.erro}`, "porta");
}
