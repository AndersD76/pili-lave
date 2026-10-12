"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { centavosDoCampo, inteiroDoCampo } from "@/lib/dinheiro";
import { ajustarInventario, entradaManual, movimentar, registrarPerda } from "@/lib/estoque";
import { exigirGestao } from "@/lib/sessao";

/** Campos do cadastro de produto (criar e editar usam os mesmos). Devolve
 *  o texto do erro em vez dos dados quando algo não fecha. */
async function dadosDoProduto(formData: FormData, idAtual?: string) {
  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) return "Informe o nome do produto.";

  const ean = String(formData.get("ean") ?? "").replace(/\D/g, "") || null;
  if (ean && (ean.length < 8 || ean.length > 14)) return "O código de barras tem de 8 a 14 números.";
  if (ean) {
    const outro = await prisma.produto.findUnique({ where: { ean } });
    if (outro && outro.id !== idAtual) return `Esse código de barras já é do produto "${outro.nome}".`;
  }

  const precoTexto = String(formData.get("preco") ?? "").trim();
  const precoCents = centavosDoCampo(precoTexto);
  if (precoTexto && precoCents === null) return "Preço de venda inválido.";
  const custoCents = centavosDoCampo(formData.get("custo")) ?? 0;
  const estoqueMinimo = inteiroDoCampo(formData.get("estoqueMinimo")) ?? 5;

  return {
    nome, ean, precoCents, custoCents, estoqueMinimo,
    unidade: String(formData.get("unidade") ?? "UN").trim().toUpperCase().slice(0, 4) || "UN",
  };
}

export async function criarProduto(formData: FormData) {
  await exigirGestao();
  const dados = await dadosDoProduto(formData);
  if (typeof dados === "string") redirect(`/produtos?erro=${encodeURIComponent(dados)}`);
  // Cadastro feito à mão exige preço: "sem preço" só existe pra produto
  // criado por nota de entrada (que traz o custo, não o preço de venda).
  if (dados.precoCents === null)
    redirect(`/produtos?erro=${encodeURIComponent("Informe o preço de venda.")}`);

  const estoqueInicial = inteiroDoCampo(formData.get("estoqueInicial")) ?? 0;
  const produto = await prisma.$transaction(async (tx) => {
    const p = await tx.produto.create({ data: dados });
    // estoque inicial também passa pelo extrato, como qualquer mudança de saldo
    if (estoqueInicial > 0)
      await movimentar(tx, { produtoId: p.id, tipo: "AJUSTE", quantidade: estoqueInicial, nota: "Estoque inicial" });
    return p;
  });
  revalidatePath("/produtos");
  redirect(`/produtos/${produto.id}`);
}

export async function salvarProduto(formData: FormData) {
  await exigirGestao();
  const id = String(formData.get("id"));
  const dados = await dadosDoProduto(formData, id);
  if (typeof dados === "string") redirect(`/produtos/${id}?erro=${encodeURIComponent(dados)}`);
  // Preço já definido não pode ser apagado (pra tirar de venda, desmarque
  // "Produto ativo"). Quem ainda está sem preço pode ser salvo assim.
  const atual = await prisma.produto.findUnique({ where: { id }, select: { precoCents: true } });
  if (dados.precoCents === null && atual?.precoCents != null)
    redirect(`/produtos/${id}?erro=${encodeURIComponent("Informe o preço de venda. Para tirar o produto de venda, desmarque \"Produto ativo\".")}`);
  await prisma.produto.update({ where: { id }, data: { ...dados, ativo: formData.get("ativo") === "on" } });
  revalidatePath("/produtos");
  redirect(`/produtos/${id}?ok=1`);
}

/** Entrada manual (soma), perda (baixa) ou ajuste de inventário (informa o contado). */
export async function movimentarEstoque(formData: FormData) {
  await exigirGestao();
  const id = String(formData.get("id"));
  const tipo = String(formData.get("tipo"));
  const quantidade = inteiroDoCampo(formData.get("quantidade"));
  const nota = String(formData.get("nota") ?? "").trim();
  const erro = (msg: string): never => redirect(`/produtos/${id}?erro=${encodeURIComponent(msg)}`);

  if (quantidade === null) erro("Informe a quantidade (número inteiro).");
  if (tipo === "ENTRADA") {
    if (quantidade === 0) erro("A entrada precisa ser de pelo menos 1.");
    const custoTexto = String(formData.get("custoUnit") ?? "").trim();
    const custo = centavosDoCampo(custoTexto);
    if (custoTexto && custo === null) erro("Custo unitário inválido.");
    await entradaManual(id, quantidade!, custo, nota);
  } else if (tipo === "PERDA") {
    if (quantidade === 0) erro("A perda precisa ser de pelo menos 1.");
    if (!nota) erro("Informe o motivo da perda (vencido, quebrado, furto…).");
    await registrarPerda(id, quantidade!, nota);
  } else if (tipo === "AJUSTE") {
    await ajustarInventario(id, quantidade!, nota || "Contagem de inventário");
  } else {
    erro("Tipo de movimento inválido.");
  }
  revalidatePath("/produtos");
  redirect(`/produtos/${id}?ok=1`);
}

/** Só pra teste: 5 produtos de exemplo. Só funciona com o cadastro vazio,
 *  pra nunca misturar produto falso no estoque de uma loja de verdade. */
export async function carregarExemplos() {
  await exigirGestao();
  if ((await prisma.produto.count()) > 0) redirect("/produtos");
  const exemplos = [
    { ean: "7894900011517", nome: "Coca-Cola lata 350ml", custoCents: 289, precoCents: 600, estoque: 24, estoqueMinimo: 12 },
    { ean: "7892840800079", nome: "Doritos Queijo Nacho 96g", custoCents: 649, precoCents: 1200, estoque: 10, estoqueMinimo: 5 },
    { ean: "7896004000855", nome: "Água mineral sem gás 500ml", custoCents: 95, precoCents: 350, estoque: 4, estoqueMinimo: 12 },
    { ean: "7622300991456", nome: "Chocolate Lacta ao leite 80g", custoCents: 499, precoCents: 900, estoque: 0, estoqueMinimo: 6 },
    { ean: "7891991000833", nome: "Guaraná Antarctica lata 350ml", custoCents: 259, precoCents: 550, estoque: 18, estoqueMinimo: 12 },
  ];
  await prisma.$transaction(async (tx) => {
    for (const { estoque, ...dados } of exemplos) {
      const p = await tx.produto.create({ data: dados });
      if (estoque > 0)
        await movimentar(tx, { produtoId: p.id, tipo: "AJUSTE", quantidade: estoque, nota: "Estoque inicial (exemplo)" });
    }
  });
  revalidatePath("/produtos");
  redirect("/produtos");
}
