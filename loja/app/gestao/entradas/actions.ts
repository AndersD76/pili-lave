"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { registrarAtividade } from "@/lib/atividade";
import { inteiroDoCampo, precoDoCampo, reais } from "@/lib/dinheiro";
import { movimentar } from "@/lib/estoque";
import { pode } from "@/lib/permissoes";
import { lerNfe } from "@/lib/nfe";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/sessao";

const BASE = "/gestao/entradas";
const MAX_XML = 3 * 1024 * 1024;

/** Recebe o XML da nota, confere que é uma NF-e que ainda não entrou e
 *  guarda como pendente — o estoque só muda na confirmação. */
export async function enviarNota(formData: FormData) {
  const { usuario } = await exigirPermissao("ENTRADA");
  const erro = (msg: string): never => redirect(`${BASE}?erro=${encodeURIComponent(msg)}`);

  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) erro("Escolha o arquivo XML da nota.");
  const f = arquivo as File;
  if (f.size > MAX_XML) erro("Arquivo grande demais para ser o XML de uma nota.");
  if (f.name.toLowerCase().endsWith(".pdf"))
    erro("Esse é o PDF da nota (DANFE). Envie o arquivo .xml — peça ao fornecedor, ele é obrigado a fornecer.");

  const xml = await f.text();
  const leitura = lerNfe(xml);
  if (!leitura.ok) erro(leitura.erro);
  const nota = (leitura as Extract<typeof leitura, { ok: true }>).nota;

  const jaEntrou = await prisma.entrada.findUnique({ where: { chaveNfe: nota.chave } });
  if (jaEntrou)
    erro(`A nota ${nota.numero} de ${nota.fornecedor.nome} já entrou no estoque em ${jaEntrou.criadaEm.toLocaleDateString("pt-BR")}.`);

  const pendente = await prisma.notaPendente.create({ data: { xml, usuarioId: usuario.id } });
  redirect(`${BASE}/conferir/${pendente.id}`);
}

export async function descartarNota(formData: FormData) {
  await exigirPermissao("ENTRADA");
  await prisma.notaPendente.deleteMany({ where: { id: String(formData.get("id")) } });
  revalidatePath(BASE);
  redirect(BASE);
}

/**
 * Confirma a conferência: pra cada item da nota, o formulário diz o que
 * fazer (`acao_N`): "novo" (criar o produto), "ignorar" (não entra no
 * estoque) ou o id de um produto que já existe; e quantas UNIDADES entram
 * (`qtd_N`). Tudo numa transação: ou a nota entra inteira, ou não entra.
 */
export async function confirmarNota(formData: FormData) {
  const { usuario } = await exigirPermissao("ENTRADA");
  const id = String(formData.get("id"));
  const erro = (msg: string): never => redirect(`${BASE}/conferir/${id}?erro=${encodeURIComponent(msg)}`);

  const pendente = await prisma.notaPendente.findUnique({ where: { id } });
  if (!pendente) redirect(BASE);
  const leitura = lerNfe(pendente!.xml);
  if (!leitura.ok) erro(leitura.erro);
  const nota = (leitura as Extract<typeof leitura, { ok: true }>).nota;

  // lê e valida as decisões ANTES de mexer em qualquer coisa
  const decisoes = nota.itens.map((item, i) => {
    const acao = String(formData.get(`acao_${i}`) ?? "ignorar");
    const quantidade = inteiroDoCampo(formData.get(`qtd_${i}`));
    return { item, acao, quantidade, precoTexto: formData.get(`preco_${i}`) };
  });
  for (const d of decisoes) {
    if (d.acao === "ignorar") continue;
    if (d.quantidade === null || d.quantidade < 1)
      erro(`Informe quantas unidades de "${d.item.descricao}" entram (ou marque "Não dar entrada").`);
  }
  // Preço de venda (opcional): valor ("5,90") ou percentual sobre o custo
  // desta nota ("30%"). Em branco não mexe no preço.
  const precos = decisoes.map((d) => {
    if (d.acao === "ignorar" || !d.quantidade) return null;
    const p = precoDoCampo(d.precoTexto, Math.round(d.item.totalCents / d.quantidade));
    if (p === "INVALIDO") erro(`Preço de venda inválido em "${d.item.descricao}". Use um valor (5,90) ou um percentual sobre o custo (30%).`);
    return p as number | null;
  });
  if (precos.some((p) => p !== null) && !pode(usuario, "PRECO"))
    erro("Você não tem permissão para alterar preço de venda. Deixe a coluna de preço em branco.");
  const entram = decisoes.map((d, i) => ({ ...d, precoCents: precos[i] })).filter((d) => d.acao !== "ignorar");
  if (entram.length === 0) erro("Nenhum item marcado para entrar. Para desistir da nota, use Descartar.");

  // dois itens da nota apontando pro mesmo código de barras novo: o segundo
  // não pode tentar criar o mesmo produto de novo
  const eansNovos = entram.filter((d) => d.acao === "novo" && d.item.ean).map((d) => d.item.ean);
  if (new Set(eansNovos).size !== eansNovos.length)
    erro("Dois itens da nota têm o mesmo código de barras. Crie o produto num deles e escolha esse produto no outro (em duas notas, ou cadastre o produto antes).");

  let entradaId = "";
  try {
    entradaId = await prisma.$transaction(async (tx) => {
      if (await tx.entrada.findUnique({ where: { chaveNfe: nota.chave } })) throw new Error("JA_ENTROU");

      const fornecedor = nota.fornecedor.cnpj
        ? await tx.fornecedor.upsert({
            where: { cnpj: nota.fornecedor.cnpj },
            update: { nome: nota.fornecedor.nome },
            create: { cnpj: nota.fornecedor.cnpj, nome: nota.fornecedor.nome },
          })
        : null;

      const entrada = await tx.entrada.create({
        data: {
          origem: "XML", numeroNf: nota.numero, chaveNfe: nota.chave, dataEmissao: nota.emissao,
          fornecedorId: fornecedor?.id ?? null, totalCents: nota.totalCents, usuarioId: usuario.id,
        },
      });

      let unidades = 0, criados = 0;
      for (const d of entram) {
        const quantidade = d.quantidade!;
        const custoUnitCents = Math.round(d.item.totalCents / quantidade);
        let produtoId = d.acao;
        if (d.acao === "novo") {
          // nasce SEM preço de venda: a nota traz o custo, não o preço
          const eanLivre = d.item.ean && !(await tx.produto.findUnique({ where: { ean: d.item.ean } })) ? d.item.ean : null;
          const novo = await tx.produto.create({
            data: { nome: d.item.descricao.slice(0, 80), ean: eanLivre, unidade: d.item.unidade, custoCents: custoUnitCents },
          });
          produtoId = novo.id;
          criados++;
        } else if (!(await tx.produto.findUnique({ where: { id: produtoId } }))) {
          throw new Error("PRODUTO_SUMIU");
        }

        const antes = await tx.produto.findUniqueOrThrow({ where: { id: produtoId }, select: { nome: true, precoCents: true } });
        const mudaPreco = d.precoCents !== null && d.precoCents !== antes.precoCents;
        await tx.produto.update({
          where: { id: produtoId },
          data: { custoCents: custoUnitCents, ...(mudaPreco ? { precoCents: d.precoCents } : {}) },
        });
        if (mudaPreco)
          await registrarAtividade(
            tx, usuario, "PRECO_ALTERADO",
            `${antes.nome}: ${antes.precoCents === null ? "sem preço" : reais(antes.precoCents)} → ${reais(d.precoCents!)} (na entrada da NF ${nota.numero}, custo ${reais(custoUnitCents)})`,
            produtoId
          );
        await tx.entradaItem.create({
          data: {
            entradaId: entrada.id, produtoId, codigoFornecedor: d.item.codigoFornecedor || null,
            descricao: d.item.descricao, quantidade, custoUnitCents,
          },
        });
        await movimentar(tx, {
          produtoId, tipo: "ENTRADA", quantidade, nota: `NF ${nota.numero} · ${nota.fornecedor.nome}`,
          refId: entrada.id, usuarioId: usuario.id,
        });
        // memória: da próxima vez, este código deste fornecedor já vem casado
        if (fornecedor && d.item.codigoFornecedor)
          await tx.codigoFornecedor.upsert({
            where: { fornecedorId_codigo: { fornecedorId: fornecedor.id, codigo: d.item.codigoFornecedor } },
            update: { produtoId },
            create: { fornecedorId: fornecedor.id, codigo: d.item.codigoFornecedor, produtoId },
          });
        unidades += quantidade;
      }

      await registrarAtividade(
        tx, usuario, "NOTA_ENTRADA",
        `NF ${nota.numero} de ${nota.fornecedor.nome}: ${entram.length} ${entram.length === 1 ? "item" : "itens"}, ${unidades} unidades, ${reais(nota.totalCents)}` +
          (criados ? `; ${criados} produto(s) novo(s)` : "") +
          (decisoes.length > entram.length ? `; ${decisoes.length - entram.length} item(ns) da nota não entraram` : "")
      );
      await tx.notaPendente.delete({ where: { id } });
      return entrada.id;
    });
  } catch (e) {
    const codigo = e instanceof Error ? e.message : "";
    if (codigo === "JA_ENTROU") erro("Essa nota já entrou no estoque.");
    if (codigo === "PRODUTO_SUMIU") erro("Um dos produtos escolhidos não existe mais. Confira a lista.");
    throw e;
  }

  revalidatePath("/gestao");
  redirect(`${BASE}?ok=${entradaId}`);
}
