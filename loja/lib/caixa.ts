import { movimentar } from "./estoque";
import { prisma } from "./prisma";

/* Caixa de autoatendimento (tela do cliente). O produto é identificado SÓ
 * pelo código de barras. Estas funções rodam sem usuário da gestão: quem
 * usa é o cliente. */

/** Limites pra uma compra não virar absurdo por um leitor travado. */
export const MAX_POR_ITEM = 99;
export const MAX_ITENS = 100;

export type ProdutoCaixa = { id: string; nome: string; ean: string; precoCents: number };

export type BuscaCaixa =
  | { situacao: "OK"; produto: ProdutoCaixa }
  | { situacao: "NAO_ENCONTRADO" }
  /** Existe, mas não pode ser vendido: sem preço definido ou tirado de venda. */
  | { situacao: "INDISPONIVEL"; nome: string };

export async function buscarPorCodigo(codigo: string): Promise<BuscaCaixa> {
  const ean = codigo.replace(/\D/g, "");
  if (!ean) return { situacao: "NAO_ENCONTRADO" };
  const p = await prisma.produto.findUnique({ where: { ean } });
  if (!p) return { situacao: "NAO_ENCONTRADO" };
  if (!p.ativo || p.precoCents === null) return { situacao: "INDISPONIVEL", nome: p.nome };
  return { situacao: "OK", produto: { id: p.id, nome: p.nome, ean, precoCents: p.precoCents } };
}

export type FormaPagamento = "CARTEIRA" | "MAQUININHA" | "SIMULADO";

export type ResultadoVenda =
  | { ok: true; numero: number; totalCents: number }
  | { ok: false; erro: string };

/**
 * Confere o carrinho (o preço vale o do cadastro AGORA, nunca o que a tela
 * mandou) sem gravar nada — é o passo antes de cobrar, pra saber o total
 * certo e detectar item que saiu de linha antes de mexer no estoque.
 */
export async function conferirCarrinho(
  itens: { produtoId: string; quantidade: number }[]
): Promise<{ ok: true; totalCents: number } | { ok: false; erro: string }> {
  const porProduto = new Map<string, number>();
  for (const i of itens) porProduto.set(i.produtoId, (porProduto.get(i.produtoId) ?? 0) + i.quantidade);
  if (porProduto.size === 0) return { ok: false, erro: "Nenhum produto na compra." };

  const produtos = await prisma.produto.findMany({ where: { id: { in: [...porProduto.keys()] } } });
  let totalCents = 0;
  for (const [produtoId, quantidade] of porProduto) {
    const p = produtos.find((x) => x.id === produtoId);
    if (!p || !p.ativo || p.precoCents === null)
      return { ok: false, erro: `"${p?.nome ?? "Um produto"}" não está mais disponível. Retire-o da compra.` };
    if (quantidade < 1 || quantidade > MAX_POR_ITEM) return { ok: false, erro: `Quantidade inválida para "${p.nome}".` };
    totalCents += quantidade * p.precoCents;
  }
  return { ok: true, totalCents };
}

/**
 * Fecha a venda: confere cada item de novo no banco, grava a Venda com os
 * itens e baixa o estoque de cada um — tudo numa transação só.
 *
 * `codigo`, quando informado, é o mesmo código já usado pra debitar a
 * carteira na nuvem (gerado ANTES de cobrar) — assim o registro local e o
 * lançamento da carteira ficam amarrados pelo mesmo id, mesmo que o
 * programa trave entre as duas chamadas.
 */
export async function finalizarVenda(
  itens: { produtoId: string; quantidade: number }[],
  forma: FormaPagamento,
  codigo?: string
): Promise<ResultadoVenda> {
  // o mesmo produto pode vir em duas linhas: junta antes de conferir
  const porProduto = new Map<string, number>();
  for (const i of itens) porProduto.set(i.produtoId, (porProduto.get(i.produtoId) ?? 0) + i.quantidade);
  if (porProduto.size === 0) return { ok: false, erro: "Nenhum produto na compra." };

  // reenvio com o mesmo código (ex.: resposta perdida antes de chegar na
  // tela): devolve a venda que já existe, sem gravar nem baixar de novo
  if (codigo) {
    const existente = await prisma.venda.findUnique({ where: { codigo } });
    if (existente) return { ok: true, numero: existente.id, totalCents: existente.totalCents };
  }

  return prisma.$transaction(async (tx) => {
    const produtos = await tx.produto.findMany({ where: { id: { in: [...porProduto.keys()] } } });
    const linhas = [];
    for (const [produtoId, quantidade] of porProduto) {
      const p = produtos.find((x) => x.id === produtoId);
      if (!p || !p.ativo || p.precoCents === null)
        return { ok: false as const, erro: `"${p?.nome ?? "Um produto"}" não está mais disponível. Retire-o da compra.` };
      if (quantidade < 1 || quantidade > MAX_POR_ITEM)
        return { ok: false as const, erro: `Quantidade inválida para "${p.nome}".` };
      linhas.push({ produtoId, nome: p.nome, ean: p.ean, quantidade, precoUnitCents: p.precoCents });
    }
    const totalCents = linhas.reduce((s, l) => s + l.quantidade * l.precoUnitCents, 0);
    const venda = await tx.venda.create({
      data: { totalCents, forma, itens: { create: linhas }, ...(codigo ? { codigo } : {}) },
    });
    for (const l of linhas)
      await movimentar(tx, {
        produtoId: l.produtoId, tipo: "VENDA", quantidade: -l.quantidade,
        nota: `Venda nº ${venda.id}`, refId: venda.codigo, usuarioId: null,
      });
    return { ok: true as const, numero: venda.id, totalCents };
  });
}
