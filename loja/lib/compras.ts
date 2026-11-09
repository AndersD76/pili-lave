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

type ItemFornecedor = {
  produtoId: string; nome: string; ean: string | null; unidade: string;
  estoqueAtual: number; estoqueMinimo: number; custoCents: number;
  /** Quantidade já marcada nesta tela (null = ainda não marcado). */
  quantidadeMarcada: number | null;
};

/**
 * Os produtos de um fornecedor pra tela de Compras, já separados em
 * "abaixo do mínimo" (sugestão de pedido) e "demais itens" (pode marcar
 * mesmo sem estar baixo). Fica de fora quem já foi marcado por OUTRO
 * fornecedor (ItemCompra.fornecedorId diferente) — é assim que gerar um
 * pedido tira o item das telas dos outros fornecedores até a entrada
 * chegar. `fornecedorId: null` é a aba "Sem fornecedor" (produtos sem
 * nenhum vínculo).
 */
export async function itensDoFornecedor(fornecedorId: string | null): Promise<{ abaixo: ItemFornecedor[]; demais: ItemFornecedor[] }> {
  const produtos = await prisma.produto.findMany({
    where: {
      ativo: true,
      fornecedores: fornecedorId ? { some: { fornecedorId } } : { none: {} },
    },
    include: { itemCompra: true },
    orderBy: { nome: "asc" },
  });

  const abaixo: ItemFornecedor[] = [];
  const demais: ItemFornecedor[] = [];
  for (const p of produtos) {
    // já marcado por outro fornecedor: resolvido em outro lugar, não aparece aqui
    if (p.itemCompra && p.itemCompra.fornecedorId !== fornecedorId) continue;
    const linha: ItemFornecedor = {
      produtoId: p.id, nome: p.nome, ean: p.ean, unidade: p.unidade,
      estoqueAtual: p.estoqueAtual, estoqueMinimo: p.estoqueMinimo, custoCents: p.custoCents,
      quantidadeMarcada: p.itemCompra?.quantidade ?? null,
    };
    (p.estoqueAtual <= p.estoqueMinimo ? abaixo : demais).push(linha);
  }
  return { abaixo, demais };
}

export type FornecedorParaCompra = {
  id: string; nome: string; pedidoMinimoCents: number | null;
  nAbaixo: number; valorSugeridoCents: number; atingiuMinimo: boolean;
};

/**
 * Lista de fornecedores pra tela de Compras, com o selo de "pedido mínimo
 * atingido": soma o custo × quantidade sugerida de cada item AINDA NÃO
 * marcado (ver itensDoFornecedor) — uma vez marcado, já está resolvido,
 * não conta mais pra decidir se vale fazer outro pedido.
 */
export async function fornecedoresParaCompra(): Promise<FornecedorParaCompra[]> {
  const fornecedores = await prisma.fornecedor.findMany({
    where: { produtos: { some: {} } }, orderBy: { nome: "asc" },
    select: { id: true, nome: true, pedidoMinimoCents: true },
  });
  const resultado: FornecedorParaCompra[] = [];
  for (const f of fornecedores) {
    const { abaixo } = await itensDoFornecedor(f.id);
    const pendentes = abaixo.filter((i) => i.quantidadeMarcada === null);
    const valorSugeridoCents = pendentes.reduce((s, i) => s + sugestaoDeCompra(i.estoqueAtual, i.estoqueMinimo) * i.custoCents, 0);
    resultado.push({
      id: f.id, nome: f.nome, pedidoMinimoCents: f.pedidoMinimoCents, nAbaixo: pendentes.length,
      valorSugeridoCents, atingiuMinimo: f.pedidoMinimoCents !== null && valorSugeridoCents >= f.pedidoMinimoCents,
    });
  }
  return resultado;
}

/** Quantos produtos ativos ainda não têm nenhum fornecedor vinculado e
 *  estão abaixo do mínimo — pro selo da aba "Sem fornecedor". */
export async function contagemSemFornecedor(): Promise<number> {
  const { abaixo } = await itensDoFornecedor(null);
  return abaixo.filter((i) => i.quantidadeMarcada === null).length;
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
