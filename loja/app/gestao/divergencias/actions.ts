"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { registrarAtividade } from "@/lib/atividade";
import { prisma } from "@/lib/prisma";
import { exigirLojista } from "@/lib/sessao";

const BASE = "/gestao/divergencias";

/** O dono registra o que decidiu sobre a divergência (ex.: "conferi as
 *  imagens, foi erro de contagem"). Nada é cobrado de ninguém por aqui. */
export async function revisarDivergencia(formData: FormData) {
  const { usuario } = await exigirLojista();
  const id = String(formData.get("id") ?? "");
  const decisao = String(formData.get("decisao") ?? "").trim();
  if (!decisao) redirect(`${BASE}?erro=${encodeURIComponent("Escreva o que foi decidido.")}`);

  const d = await prisma.divergencia.findUnique({ where: { id } });
  if (!d || d.situacao !== "ABERTA") redirect(`${BASE}?erro=${encodeURIComponent("Divergência não encontrada ou já revisada.")}`);

  await prisma.$transaction(async (tx) => {
    await tx.divergencia.update({
      where: { id }, data: { situacao: "REVISADA", decisao, revisadaPor: usuario.nome, revisadaEm: new Date() },
    });
    await registrarAtividade(
      tx, usuario, "DIVERGENCIA_REVISADA",
      `Saíram ${d.saiuPrateleira}, pagas ${d.pago} — decisão: ${decisao}`
    );
  });
  revalidatePath(BASE);
  redirect(`${BASE}?ok=1`);
}
