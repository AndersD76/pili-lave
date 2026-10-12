"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { registrarAtividade } from "@/lib/atividade";
import { centavosDoCampo, inteiroDoCampo, reais } from "@/lib/dinheiro";
import { ajustarInventario, entradaManual, movimentar, registrarPerda } from "@/lib/estoque";
import { pode, rotuloPermissao, type Permissao } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { exigirGestao, exigirPermissao } from "@/lib/sessao";

const BASE = "/gestao/produtos";

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
  const { usuario } = await exigirPermissao("PRODUTOS");
  const erro = (msg: string): never => redirect(`${BASE}?erro=${encodeURIComponent(msg)}`);

  const dados = await dadosDoProduto(formData);
  if (typeof dados === "string") erro(dados);
  const d = dados as Exclude<typeof dados, string>;
  // Cadastro feito à mão exige preço: "sem preço" só existe pra produto
  // criado por nota de entrada (que traz o custo, não o preço de venda).
  if (d.precoCents === null) erro("Informe o preço de venda.");

  const estoqueInicial = inteiroDoCampo(formData.get("estoqueInicial")) ?? 0;
  // estoque inicial é uma entrada: sem essa permissão, o produto nasce zerado
  if (estoqueInicial > 0 && !pode(usuario, "ENTRADA"))
    erro("Você pode cadastrar o produto, mas não tem permissão para dar entrada. Deixe o estoque inicial em 0.");

  const produto = await prisma.$transaction(async (tx) => {
    const p = await tx.produto.create({ data: d });
    await registrarAtividade(
      tx, usuario, "PRODUTO_CRIADO",
      `${p.nome}${p.ean ? ` (${p.ean})` : ""}: preço ${reais(p.precoCents ?? 0)}, custo ${reais(p.custoCents)}, mínimo ${p.estoqueMinimo}`,
      p.id
    );
    // estoque inicial também passa pelo extrato, como qualquer mudança de saldo
    if (estoqueInicial > 0) {
      await movimentar(tx, {
        produtoId: p.id, tipo: "AJUSTE", quantidade: estoqueInicial, nota: "Estoque inicial", usuarioId: usuario.id,
      });
      await registrarAtividade(tx, usuario, "ENTRADA", `${p.nome}: estoque inicial ${estoqueInicial}`, p.id);
    }
    return p;
  });
  revalidatePath(BASE);
  redirect(`${BASE}/${produto.id}`);
}

export async function salvarProduto(formData: FormData) {
  const { usuario } = await exigirGestao();
  const id = String(formData.get("id"));
  const erro = (msg: string): never => redirect(`${BASE}/${id}?erro=${encodeURIComponent(msg)}`);
  const semPermissao = (p: Permissao): never =>
    erro(`Você não tem permissão para: ${rotuloPermissao(p).toLowerCase()}.`);

  const antes = await prisma.produto.findUnique({ where: { id } });
  if (!antes) erro("Produto não encontrado.");
  const a = antes!;
  const dados = await dadosDoProduto(formData, id);
  if (typeof dados === "string") erro(dados);
  const d = dados as Exclude<typeof dados, string>;
  const ativo = formData.get("ativo") === "on";

  // Preço já definido não pode ser apagado (pra tirar de venda, desmarque
  // "Produto ativo"). Quem ainda está sem preço pode ser salvo assim.
  if (d.precoCents === null && a.precoCents !== null)
    erro("Informe o preço de venda. Para tirar o produto de venda, desmarque \"Produto ativo\".");

  // O que mudou — é isso que vai pro registro, e é por isso que cada
  // permissão é conferida: preço é uma, o resto do cadastro é outra.
  const mudouPreco = d.precoCents !== a.precoCents;
  const mudancas: string[] = [];
  if (d.nome !== a.nome) mudancas.push(`nome "${a.nome}" → "${d.nome}"`);
  if (d.ean !== a.ean) mudancas.push(`código de barras ${a.ean ?? "—"} → ${d.ean ?? "—"}`);
  if (d.custoCents !== a.custoCents) mudancas.push(`custo ${reais(a.custoCents)} → ${reais(d.custoCents)}`);
  if (d.estoqueMinimo !== a.estoqueMinimo) mudancas.push(`mínimo ${a.estoqueMinimo} → ${d.estoqueMinimo}`);
  if (d.unidade !== a.unidade) mudancas.push(`unidade ${a.unidade} → ${d.unidade}`);
  if (ativo !== a.ativo) mudancas.push(ativo ? "reativado" : "desativado");

  if (mudouPreco && !pode(usuario, "PRECO")) semPermissao("PRECO");
  if (mudancas.length > 0 && !pode(usuario, "PRODUTOS")) semPermissao("PRODUTOS");
  if (!mudouPreco && mudancas.length === 0) redirect(`${BASE}/${id}`);

  await prisma.$transaction(async (tx) => {
    await tx.produto.update({ where: { id }, data: { ...d, ativo } });
    if (mudouPreco)
      await registrarAtividade(
        tx, usuario, "PRECO_ALTERADO",
        `${d.nome}: ${a.precoCents === null ? "sem preço" : reais(a.precoCents)} → ${reais(d.precoCents ?? 0)}`, id
      );
    if (mudancas.length > 0)
      await registrarAtividade(tx, usuario, "PRODUTO_ALTERADO", `${a.nome}: ${mudancas.join("; ")}`, id);
  });
  revalidatePath(BASE);
  redirect(`${BASE}/${id}?ok=1`);
}

/** Entrada manual (soma), perda (baixa) ou ajuste de inventário (informa o contado). */
export async function movimentarEstoque(formData: FormData) {
  const tipo = String(formData.get("tipo"));
  const permissao: Permissao | null =
    tipo === "ENTRADA" ? "ENTRADA" : tipo === "PERDA" ? "PERDA" : tipo === "AJUSTE" ? "INVENTARIO" : null;
  if (!permissao) redirect(BASE);
  const { usuario } = await exigirPermissao(permissao);

  const id = String(formData.get("id"));
  const quantidade = inteiroDoCampo(formData.get("quantidade"));
  const nota = String(formData.get("nota") ?? "").trim();
  const erro = (msg: string): never => redirect(`${BASE}/${id}?erro=${encodeURIComponent(msg)}`);

  if (quantidade === null) erro("Informe a quantidade (número inteiro).");
  if (tipo === "ENTRADA") {
    if (quantidade === 0) erro("A entrada precisa ser de pelo menos 1.");
    const custoTexto = String(formData.get("custoUnit") ?? "").trim();
    const custo = centavosDoCampo(custoTexto);
    if (custoTexto && custo === null) erro("Custo unitário inválido.");
    await entradaManual(usuario, id, quantidade!, custo, nota);
  } else if (tipo === "PERDA") {
    if (quantidade === 0) erro("A perda precisa ser de pelo menos 1.");
    if (!nota) erro("Informe o motivo da perda (vencido, quebrado, furto…).");
    await registrarPerda(usuario, id, quantidade!, nota);
  } else {
    await ajustarInventario(usuario, id, quantidade!, nota || "Contagem de inventário");
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}?ok=1`);
}

/** Só pra teste: 5 produtos de exemplo. Só funciona com o cadastro vazio,
 *  pra nunca misturar produto falso no estoque de uma loja de verdade. */
export async function carregarExemplos() {
  const { usuario } = await exigirGestao();
  if (usuario.papel !== "LOJISTA" || (await prisma.produto.count()) > 0) redirect(BASE);
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
        await movimentar(tx, {
          produtoId: p.id, tipo: "AJUSTE", quantidade: estoque, nota: "Estoque inicial (exemplo)", usuarioId: usuario.id,
        });
    }
    await registrarAtividade(tx, usuario, "PRODUTO_CRIADO", "Carregou os 5 produtos de exemplo");
  });
  revalidatePath(BASE);
  redirect(BASE);
}
