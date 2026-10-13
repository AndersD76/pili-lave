"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { registrarAtividade } from "@/lib/atividade";
import { inteiroDoCampo } from "@/lib/dinheiro";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/sessao";

const BASE = "/gestao/compras";

/**
 * Salva as marcações da tabela de escolha. O formulário manda em `ids`
 * todos os produtos que estavam NA TELA: os marcados (`sel_<id>`) entram ou
 * são atualizados com a quantidade (`qtd_<id>`); os desmarcados saem. Quem
 * não estava na tela (outra visão, outra busca) não é tocado.
 */
export async function salvarMarcacoes(formData: FormData) {
  const { usuario } = await exigirPermissao("COMPRAS");
  const voltar = String(formData.get("voltar") ?? BASE);
  const destino = voltar.startsWith(BASE) ? voltar : BASE;
  const com = (qs: string) => `${destino}${destino.includes("?") ? "&" : "?"}${qs}`;

  const ids = String(formData.get("ids") ?? "").split(",").filter(Boolean);
  const marcados: { produtoId: string; quantidade: number }[] = [];
  for (const id of ids) {
    if (formData.get(`sel_${id}`) !== "on") continue;
    const quantidade = inteiroDoCampo(formData.get(`qtd_${id}`));
    if (quantidade === null || quantidade < 1)
      redirect(com(`erro=${encodeURIComponent("Informe a quantidade (pelo menos 1) de cada item marcado.")}`));
    marcados.push({ produtoId: id, quantidade: quantidade! });
  }

  const [entraram, sairam] = await prisma.$transaction(async (tx) => {
    const antes = new Set((await tx.itemCompra.findMany({ where: { produtoId: { in: ids } }, select: { produtoId: true } })).map((i) => i.produtoId));
    const fora = ids.filter((id) => !marcados.some((m) => m.produtoId === id));
    await tx.itemCompra.deleteMany({ where: { produtoId: { in: fora } } });
    for (const m of marcados)
      await tx.itemCompra.upsert({
        where: { produtoId: m.produtoId },
        update: { quantidade: m.quantidade },
        create: { produtoId: m.produtoId, quantidade: m.quantidade, usuarioId: usuario.id },
      });
    const novos = marcados.filter((m) => !antes.has(m.produtoId)).length;
    const removidos = fora.filter((id) => antes.has(id)).length;
    if (novos > 0 || removidos > 0)
      await registrarAtividade(
        tx, usuario, "LISTA_COMPRAS",
        [novos ? `${novos} item(ns) incluído(s)` : "", removidos ? `${removidos} retirado(s)` : ""].filter(Boolean).join(", ") +
          `; a lista ficou com ${await tx.itemCompra.count()} item(ns)`
      );
    return [novos, removidos];
  });
  revalidatePath(BASE);
  redirect(com(`ok=${entraram + sairam > 0 ? "lista" : "qtd"}`));
}

/** Esvazia a lista inteira (depois de comprar, por exemplo). */
export async function limparLista() {
  const { usuario } = await exigirPermissao("COMPRAS");
  await prisma.$transaction(async (tx) => {
    const n = await tx.itemCompra.count();
    if (n === 0) return;
    await tx.itemCompra.deleteMany();
    await registrarAtividade(tx, usuario, "LISTA_COMPRAS", `Lista esvaziada (${n} item(ns))`);
  });
  revalidatePath(BASE);
  redirect(BASE);
}
