"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { registrarAtividade } from "@/lib/atividade";
import { centavosDoCampo, inteiroDoCampo, reais } from "@/lib/dinheiro";
import { ajustarInventario, entradaManual, movimentar, registrarPerda } from "@/lib/estoque";
import { pode, rotuloPermissao, type Permissao } from "@/lib/permissoes";
import { formatarPercentual, lerPercentual, precoPelaMargem, reajustarPreco } from "@/lib/precos";
import { prisma } from "@/lib/prisma";
import { exigirGestao, exigirPermissao } from "@/lib/sessao";

const BASE = "/gestao/produtos";

/** Campos do cadastro de produto (criar e editar usam os mesmos). Devolve
 *  o texto do erro em vez dos dados quando algo não fecha.
 *
 *  Preço: a regra é o PERCENTUAL sobre o custo (`margem`); o preço sai da
 *  conta. Com "preço manual" marcado, vale o preço digitado e o produto
 *  deixa de ser reajustado. */
async function dadosDoProduto(formData: FormData, idAtual?: string) {
  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) return "Informe o nome do produto.";

  const ean = String(formData.get("ean") ?? "").replace(/\D/g, "") || null;
  if (ean && (ean.length < 8 || ean.length > 14)) return "O código de barras tem de 8 a 14 números.";
  if (ean) {
    const outro = await prisma.produto.findUnique({ where: { ean } });
    if (outro && outro.id !== idAtual) return `Esse código de barras já é do produto "${outro.nome}".`;
  }

  const custoCents = centavosDoCampo(formData.get("custo")) ?? 0;
  const estoqueMinimo = inteiroDoCampo(formData.get("estoqueMinimo")) ?? 5;
  const precoManual = formData.get("precoManual") === "on";

  let margemPct: number | null = null;
  let precoDigitado: number | null = null;
  if (precoManual) {
    precoDigitado = centavosDoCampo(formData.get("preco"));
    if (precoDigitado === null) return "Com preço manual, informe o preço de venda.";
  } else {
    const m = lerPercentual(formData.get("margem"));
    if (m === "INVALIDO") return "Percentual de venda inválido. Use um número, como 40 ou 12,5.";
    margemPct = m;
  }

  return {
    nome, ean, custoCents, estoqueMinimo, precoManual, margemPct, precoDigitado,
    unidade: String(formData.get("unidade") ?? "UN").trim().toUpperCase().slice(0, 4) || "UN",
  };
}

export async function criarProduto(formData: FormData) {
  const { usuario } = await exigirPermissao("PRODUTOS");
  const erro = (msg: string): never => redirect(`${BASE}?erro=${encodeURIComponent(msg)}`);

  const dados = await dadosDoProduto(formData);
  if (typeof dados === "string") erro(dados);
  const { precoDigitado, ...d } = dados as Exclude<typeof dados, string>;
  // Cadastro feito à mão precisa sair vendável: percentual ou preço manual.
  // "Sem preço" só existe pra produto criado por nota de entrada.
  if (!d.precoManual && d.margemPct === null) erro("Informe o percentual de venda (ou marque preço manual e informe o preço).");
  const precoCents = d.precoManual ? precoDigitado : precoPelaMargem(d.custoCents, d.margemPct!);

  const estoqueInicial = inteiroDoCampo(formData.get("estoqueInicial")) ?? 0;
  // estoque inicial é uma entrada: sem essa permissão, o produto nasce zerado
  if (estoqueInicial > 0 && !pode(usuario, "ENTRADA"))
    erro("Você pode cadastrar o produto, mas não tem permissão para dar entrada. Deixe o estoque inicial em 0.");

  const produto = await prisma.$transaction(async (tx) => {
    const p = await tx.produto.create({ data: { ...d, precoCents } });
    await registrarAtividade(
      tx, usuario, "PRODUTO_CRIADO",
      `${p.nome}${p.ean ? ` (${p.ean})` : ""}: custo ${reais(p.custoCents)}, ` +
        (p.precoManual ? `preço manual ${reais(p.precoCents ?? 0)}` : `${formatarPercentual(p.margemPct!)} → preço ${reais(p.precoCents ?? 0)}`) +
        `, mínimo ${p.estoqueMinimo}`,
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
  const { precoDigitado, ...d } = dados as Exclude<typeof dados, string>;
  const ativo = formData.get("ativo") === "on";

  // O que mudou — é isso que vai pro registro, e é por isso que cada
  // permissão é conferida: preço é uma, o resto do cadastro é outra.
  const mudancas: string[] = [];
  if (d.nome !== a.nome) mudancas.push(`nome "${a.nome}" → "${d.nome}"`);
  if (d.ean !== a.ean) mudancas.push(`código de barras ${a.ean ?? "—"} → ${d.ean ?? "—"}`);
  if (d.custoCents !== a.custoCents) mudancas.push(`custo ${reais(a.custoCents)} → ${reais(d.custoCents)}`);
  if (d.estoqueMinimo !== a.estoqueMinimo) mudancas.push(`mínimo ${a.estoqueMinimo} → ${d.estoqueMinimo}`);
  if (d.unidade !== a.unidade) mudancas.push(`unidade ${a.unidade} → ${d.unidade}`);
  if (ativo !== a.ativo) mudancas.push(ativo ? "reativado" : "desativado");

  // regra de preço: percentual, manual, ou as duas coisas mudando
  const regra: string[] = [];
  if (d.precoManual !== a.precoManual)
    regra.push(d.precoManual ? "passou a ter PREÇO MANUAL (sem reajuste automático)" : "voltou ao reajuste automático");
  if (!d.precoManual && d.margemPct !== a.margemPct)
    regra.push(`percentual ${a.margemPct === null ? "—" : formatarPercentual(a.margemPct)} → ${d.margemPct === null ? "—" : formatarPercentual(d.margemPct)}`);
  const mudouPrecoManual = d.precoManual && precoDigitado !== a.precoCents;

  if ((regra.length > 0 || mudouPrecoManual) && !pode(usuario, "PRECO")) semPermissao("PRECO");
  if (mudancas.length > 0 && !pode(usuario, "PRODUTOS")) semPermissao("PRODUTOS");
  if (mudancas.length === 0 && regra.length === 0 && !mudouPrecoManual) redirect(`${BASE}/${id}`);

  await prisma.$transaction(async (tx) => {
    await tx.produto.update({
      where: { id },
      data: {
        nome: d.nome, ean: d.ean, custoCents: d.custoCents, estoqueMinimo: d.estoqueMinimo, unidade: d.unidade, ativo,
        precoManual: d.precoManual,
        // entrando no manual, o percentual que havia continua guardado pra quando voltar
        margemPct: d.precoManual ? a.margemPct : d.margemPct,
        ...(d.precoManual ? { precoCents: precoDigitado } : {}),
      },
    });
    if (mudancas.length > 0)
      await registrarAtividade(tx, usuario, "PRODUTO_ALTERADO", `${a.nome}: ${mudancas.join("; ")}`, id);
    if (regra.length > 0)
      await registrarAtividade(tx, usuario, "PERCENTUAL_ALTERADO", `${d.nome}: ${regra.join("; ")}`, id);
    if (mudouPrecoManual)
      await registrarAtividade(
        tx, usuario, "PRECO_ALTERADO",
        `${d.nome}: ${a.precoCents === null ? "sem preço" : reais(a.precoCents)} → ${reais(precoDigitado ?? 0)} (preço manual)`, id
      );
    // custo ou percentual novo: o preço acompanha (não faz nada se for manual)
    await reajustarPreco(tx, usuario, id, "alteração no cadastro");
  });
  revalidatePath(BASE);
  redirect(`${BASE}/${id}?ok=1`);
}

/**
 * Define o percentual de venda de vários produtos de uma vez (lista "Sem
 * percentual" e tabela "Sem preço de venda" do painel). Cada campo
 * `pct_<id>` é um percentual sobre o custo; em branco, fica como está. O
 * preço de cada um é recalculado na hora. Se um estiver inválido, nenhum é
 * salvo.
 */
export async function definirPercentuais(formData: FormData) {
  const { usuario } = await exigirPermissao("PRECO");
  const voltar = String(formData.get("voltar") ?? "") === "painel" ? "/gestao" : `${BASE}?f=sempct`;
  const com = (qs: string) => `${voltar}${voltar.includes("?") ? "&" : "?"}${qs}`;
  const erro = (msg: string): never => redirect(com(`erro=${encodeURIComponent(msg)}`));

  const ids = [...formData.keys()].filter((k) => k.startsWith("pct_")).map((k) => k.slice(4));
  const produtos = await prisma.produto.findMany({ where: { id: { in: ids }, precoManual: false } });
  const mudancas: { id: string; nome: string; antes: number | null; depois: number }[] = [];
  for (const p of produtos) {
    const pct = lerPercentual(formData.get(`pct_${p.id}`));
    if (pct === null) continue;
    if (pct === "INVALIDO") erro(`Percentual inválido em "${p.nome}". Use um número, como 40 ou 12,5.`);
    if (pct !== p.margemPct) mudancas.push({ id: p.id, nome: p.nome, antes: p.margemPct, depois: pct as number });
  }
  if (mudancas.length === 0) redirect(voltar);

  await prisma.$transaction(async (tx) => {
    for (const m of mudancas) {
      await tx.produto.update({ where: { id: m.id }, data: { margemPct: m.depois } });
      await registrarAtividade(
        tx, usuario, "PERCENTUAL_ALTERADO",
        `${m.nome}: percentual ${m.antes === null ? "—" : formatarPercentual(m.antes)} → ${formatarPercentual(m.depois)}`, m.id
      );
      await reajustarPreco(tx, usuario, m.id, "percentual definido");
    }
  });
  revalidatePath(BASE);
  revalidatePath("/gestao");
  redirect(com("ok=1"));
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
    { ean: "7894900011517", nome: "Coca-Cola lata 350ml", custoCents: 289, margemPct: 100, estoque: 24, estoqueMinimo: 12 },
    { ean: "7892840800079", nome: "Doritos Queijo Nacho 96g", custoCents: 649, margemPct: 85, estoque: 10, estoqueMinimo: 5 },
    { ean: "7896004000855", nome: "Água mineral sem gás 500ml", custoCents: 95, margemPct: 250, estoque: 4, estoqueMinimo: 12 },
    { ean: "7622300991456", nome: "Chocolate Lacta ao leite 80g", custoCents: 499, margemPct: 80, estoque: 0, estoqueMinimo: 6 },
    { ean: "7891991000833", nome: "Guaraná Antarctica lata 350ml", custoCents: 259, margemPct: 110, estoque: 18, estoqueMinimo: 12 },
  ];
  await prisma.$transaction(async (tx) => {
    for (const { estoque, ...dados } of exemplos) {
      const p = await tx.produto.create({ data: { ...dados, precoCents: precoPelaMargem(dados.custoCents, dados.margemPct) } });
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
