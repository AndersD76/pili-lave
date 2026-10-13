import { prisma } from "./prisma";

/* Lista de compras: os produtos que o lojista marcou pra comprar, com a
 * quantidade. A tela e a planilha usam esta mesma função. */

/** Quantidade sugerida pra um produto: o que falta pra passar do mínimo
 *  (o mesmo número da coluna "Faltam" do painel), nunca menos que 1. */
export function sugestaoDeCompra(estoqueAtual: number, estoqueMinimo: number): number {
  return Math.max(1, estoqueMinimo - estoqueAtual + 1);
}

/** Último fornecedor de quem cada produto foi comprado (pela nota fiscal). */
export async function ultimoFornecedorDe(produtoIds: string[]): Promise<Map<string, string>> {
  const itens = await prisma.entradaItem.findMany({
    where: { produtoId: { in: produtoIds }, entrada: { fornecedorId: { not: null } } },
    orderBy: { entrada: { criadaEm: "desc" } },
    select: { produtoId: true, entrada: { select: { fornecedor: { select: { nome: true } } } } },
  });
  const mapa = new Map<string, string>();
  for (const i of itens) if (!mapa.has(i.produtoId) && i.entrada.fornecedor) mapa.set(i.produtoId, i.entrada.fornecedor.nome);
  return mapa;
}

/** A lista de compras atual, com o valor estimado pelo último custo. */
export async function listaDeCompras() {
  const itens = await prisma.itemCompra.findMany({ include: { produto: true }, orderBy: { produto: { nome: "asc" } } });
  const fornecedores = await ultimoFornecedorDe(itens.map((i) => i.produtoId));
  const linhas = itens.map((i) => ({
    produtoId: i.produtoId, nome: i.produto.nome, ean: i.produto.ean, unidade: i.produto.unidade,
    estoque: i.produto.estoqueAtual, minimo: i.produto.estoqueMinimo,
    quantidade: i.quantidade, custoCents: i.produto.custoCents,
    totalCents: i.quantidade * i.produto.custoCents,
    fornecedor: fornecedores.get(i.produtoId) ?? "",
  }));
  return {
    linhas,
    total: {
      itens: linhas.length,
      unidades: linhas.reduce((s, l) => s + l.quantidade, 0),
      valorCents: linhas.reduce((s, l) => s + l.totalCents, 0),
    },
  };
}
