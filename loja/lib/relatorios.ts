import { prisma } from "./prisma";

/* Relatórios da gestão. Cada função devolve os dados prontos pra tela E pro
 * arquivo CSV (app/gestao/relatorios/csv) — as duas saídas usam a mesma
 * conta, pra nunca mostrarem números diferentes. */

export const RELATORIOS = [
  { chave: "estoque", rotulo: "Estoque" },
  { chave: "entradas", rotulo: "Entradas" },
  { chave: "saidas", rotulo: "Saídas (vendas)" },
  { chave: "perdas", rotulo: "Perdas e ajustes" },
] as const;
export type TipoRelatorio = (typeof RELATORIOS)[number]["chave"];

export type Periodo = { de: string; ate: string; inicio: Date; fim: Date };

const FUSO = "-03:00"; // Brasília: a loja pensa em dias de calendário daqui

function hojeIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/** Período do relatório a partir do que veio na URL ("AAAA-MM-DD"). Padrão:
 *  do dia 1 do mês até hoje. `fim` é exclusivo (o começo do dia seguinte). */
export function lerPeriodo(de?: string, ate?: string): Periodo {
  const valido = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00${FUSO}`).getTime()) ? s : null);
  const hoje = hojeIso();
  let d = valido(de) ?? `${hoje.slice(0, 8)}01`;
  let a = valido(ate) ?? hoje;
  if (d > a) [d, a] = [a, d];
  const fim = new Date(`${a}T00:00:00${FUSO}`);
  fim.setUTCDate(fim.getUTCDate() + 1);
  return { de: d, ate: a, inicio: new Date(`${d}T00:00:00${FUSO}`), fim };
}

async function nomesDosUsuarios() {
  const us = await prisma.usuario.findMany({ select: { id: true, nome: true } });
  return new Map(us.map((u) => [u.id, u.nome]));
}

/** Posição do estoque AGORA (não depende do período). */
export async function relatorioEstoque() {
  const produtos = await prisma.produto.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } });
  const linhas = produtos.map((p) => ({
    id: p.id, nome: p.nome, ean: p.ean, estoque: p.estoqueAtual, minimo: p.estoqueMinimo,
    custoCents: p.custoCents, precoCents: p.precoCents,
    // estoque negativo não vale dinheiro negativo
    valorCustoCents: Math.max(0, p.estoqueAtual) * p.custoCents,
    valorVendaCents: Math.max(0, p.estoqueAtual) * (p.precoCents ?? 0),
    situacao: p.estoqueAtual <= 0 ? "Zerado" : p.estoqueAtual <= p.estoqueMinimo ? "No mínimo" : "OK",
  }));
  return {
    linhas,
    total: {
      produtos: linhas.length,
      unidades: linhas.reduce((s, l) => s + Math.max(0, l.estoque), 0),
      valorCustoCents: linhas.reduce((s, l) => s + l.valorCustoCents, 0),
      valorVendaCents: linhas.reduce((s, l) => s + l.valorVendaCents, 0),
      paraComprar: linhas.filter((l) => l.situacao !== "OK").length,
    },
  };
}

/** Entradas de mercadoria no período (nota fiscal e manuais), item a item. */
export async function relatorioEntradas(p: Periodo) {
  const [entradas, nomes] = await Promise.all([
    prisma.entrada.findMany({
      where: { criadaEm: { gte: p.inicio, lt: p.fim } },
      orderBy: { criadaEm: "asc" },
      include: { fornecedor: true, itens: { include: { produto: { select: { nome: true } } } } },
    }),
    nomesDosUsuarios(),
  ]);
  const linhas = entradas.flatMap((e) =>
    e.itens.map((i) => ({
      quando: e.criadaEm, origem: e.origem === "MANUAL" ? "Manual" : "Nota fiscal",
      fornecedor: e.fornecedor?.nome ?? "", nota: e.numeroNf ?? "",
      produto: i.produto.nome, quantidade: i.quantidade, custoUnitCents: i.custoUnitCents,
      totalCents: i.quantidade * i.custoUnitCents, quem: e.usuarioId ? (nomes.get(e.usuarioId) ?? "") : "",
    }))
  );
  return {
    linhas,
    total: {
      entradas: entradas.length,
      unidades: linhas.reduce((s, l) => s + l.quantidade, 0),
      valorCents: linhas.reduce((s, l) => s + l.totalCents, 0),
    },
  };
}

/** Vendas do período, somadas por produto, da mais vendida pra menos. */
export async function relatorioSaidas(p: Periodo) {
  const vendas = await prisma.venda.findMany({
    where: { criadaEm: { gte: p.inicio, lt: p.fim } },
    include: { itens: true },
  });
  const porProduto = new Map<string, { produto: string; ean: string | null; quantidade: number; receitaCents: number }>();
  for (const v of vendas)
    for (const i of v.itens) {
      const atual = porProduto.get(i.produtoId) ?? { produto: i.nome, ean: i.ean, quantidade: 0, receitaCents: 0 };
      atual.quantidade += i.quantidade;
      atual.receitaCents += i.quantidade * i.precoUnitCents;
      porProduto.set(i.produtoId, atual);
    }
  const linhas = [...porProduto.values()].sort((a, b) => b.quantidade - a.quantidade || a.produto.localeCompare(b.produto));
  const receitaCents = vendas.reduce((s, v) => s + v.totalCents, 0);
  return {
    linhas,
    total: {
      vendas: vendas.length,
      unidades: linhas.reduce((s, l) => s + l.quantidade, 0),
      receitaCents,
      ticketMedioCents: vendas.length ? Math.round(receitaCents / vendas.length) : 0,
      simuladas: vendas.filter((v) => v.forma === "SIMULADO").length,
    },
  };
}

/** Perdas lançadas e ajustes de inventário no período. O valor é a
 *  quantidade vezes o custo ATUAL do produto (o custo da época não é
 *  guardado no movimento). */
export async function relatorioPerdas(p: Periodo) {
  const [movs, nomes] = await Promise.all([
    prisma.movimento.findMany({
      where: {
        criadoEm: { gte: p.inicio, lt: p.fim },
        // "Estoque inicial" também é um AJUSTE no extrato, mas não é diferença de inventário
        OR: [{ tipo: "PERDA" }, { tipo: "AJUSTE", NOT: { nota: { startsWith: "Estoque inicial" } } }],
      },
      orderBy: { criadoEm: "asc" },
      include: { produto: { select: { nome: true, custoCents: true } } },
    }),
    nomesDosUsuarios(),
  ]);
  const linhas = movs.map((m) => ({
    quando: m.criadoEm, tipo: m.tipo === "PERDA" ? "Perda" : "Ajuste de inventário",
    produto: m.produto.nome, quantidade: m.quantidade, valorCents: m.quantidade * m.produto.custoCents,
    motivo: m.nota ?? "", quem: m.usuarioId ? (nomes.get(m.usuarioId) ?? "") : "",
  }));
  const perdas = linhas.filter((l) => l.tipo === "Perda");
  const ajustes = linhas.filter((l) => l.tipo !== "Perda");
  return {
    linhas,
    total: {
      perdasUnidades: perdas.reduce((s, l) => s - l.quantidade, 0),
      perdasValorCents: perdas.reduce((s, l) => s - l.valorCents, 0),
      ajustesUnidades: ajustes.reduce((s, l) => s + l.quantidade, 0),
      ajustesValorCents: ajustes.reduce((s, l) => s + l.valorCents, 0),
    },
  };
}
