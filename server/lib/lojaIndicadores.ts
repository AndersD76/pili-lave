/**
 * Indicadores da loja de conveniência, calculados a partir das vendas que o
 * computador da loja sincroniza (VendaLoja). Usado pelo dono (app) e pelo
 * admin (/admin/lojas).
 *
 * - Venda SIMULADO (teste do caixa) não conta.
 * - Venda pela carteira que foi estornada (cancelada depois) não conta.
 * - Faixa etária só existe pra venda pela carteira: é o débito na carteira
 *   (WalletTx LOJA, refId = código da venda) que diz quem comprou. Cartão é
 *   anônimo e entra como "Sem identificação".
 */
import { prisma } from "./prisma";

/** Brasil não tem horário de verão: hora local = UTC-3. */
const FUSO_MS = -3 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const FAIXAS = ["Até 17", "18 a 24", "25 a 34", "35 a 44", "45 a 59", "60 ou mais"] as const;
const SEM_ID = "Sem identificação";

function faixaDe(idade: number): string {
  if (idade < 18) return FAIXAS[0];
  if (idade < 25) return FAIXAS[1];
  if (idade < 35) return FAIXAS[2];
  if (idade < 45) return FAIXAS[3];
  if (idade < 60) return FAIXAS[4];
  return FAIXAS[5];
}

function idadeEm(nascimento: Date, quando: Date): number {
  let idade = quando.getUTCFullYear() - nascimento.getUTCFullYear();
  const antesDoAniversario =
    quando.getUTCMonth() < nascimento.getUTCMonth() ||
    (quando.getUTCMonth() === nascimento.getUTCMonth() && quando.getUTCDate() < nascimento.getUTCDate());
  if (antesDoAniversario) idade--;
  return idade;
}

/** "AAAA-MM-DD" (dia local) → instante UTC do começo desse dia no Brasil. */
function inicioDoDia(dia: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - FUSO_MS);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diaLocal(d: Date): string {
  return new Date(d.getTime() + FUSO_MS).toISOString().slice(0, 10);
}

/** Período pedido na URL (?de=AAAA-MM-DD&ate=AAAA-MM-DD, os dois inclusive).
 *  Sem parâmetros: últimos 30 dias. null = datas inválidas. */
export function periodoDaUrl(params: { get(nome: string): string | null }): { de: string; ate: string } | null {
  const ate = params.get("ate") || diaLocal(new Date());
  const fim = inicioDoDia(ate);
  if (!fim) return null;
  const de = params.get("de") || diaLocal(new Date(fim.getTime() - 29 * DIA_MS));
  const inicio = inicioDoDia(de);
  if (!inicio || inicio > fim || fim.getTime() - inicio.getTime() > 366 * DIA_MS) return null;
  return { de, ate };
}

type Grupo = { vendas: number; totalCents: number };
const vazio = (): Grupo => ({ vendas: 0, totalCents: 0 });

export type IndicadoresLoja = Awaited<ReturnType<typeof indicadoresDaLoja>>;

export async function indicadoresDaLoja(lojaId: string, periodo: { de: string; ate: string }) {
  const inicio = inicioDoDia(periodo.de)!;
  const fim = new Date(inicioDoDia(periodo.ate)!.getTime() + DIA_MS);

  const todas = await prisma.vendaLoja.findMany({
    where: { lojaId, criadaEm: { gte: inicio, lt: fim }, forma: { not: "SIMULADO" } },
    include: { itens: true },
  });
  const codigos = todas.map((v) => v.codigo);

  const [debitos, estornos] = await Promise.all([
    prisma.walletTx.findMany({
      where: { kind: "LOJA", refId: { in: codigos } },
      select: { refId: true, user: { select: { nascimento: true } } },
    }),
    prisma.walletTx.findMany({
      where: { kind: "REFUND", refId: { in: codigos.map((c) => `estorno:${c}`) } },
      select: { refId: true },
    }),
  ]);
  const estornadas = new Set(estornos.map((e) => e.refId!.slice("estorno:".length)));
  const nascimentoPorVenda = new Map(debitos.map((d) => [d.refId!, d.user.nascimento]));
  const vendas = todas.filter((v) => !estornadas.has(v.codigo));

  const porForma = new Map<string, Grupo>();
  const porHora = Array.from({ length: 24 }, vazio);
  const porDiaSemana = Array.from({ length: 7 }, vazio);
  const porDia = new Map<string, Grupo>();
  const porFaixa = new Map<string, Grupo>();
  const itens = new Map<string, { nome: string; ean: string | null; quantidade: number; totalCents: number }>();
  let faturamentoCents = 0;

  const somar = (g: Grupo, cents: number) => { g.vendas++; g.totalCents += cents; };
  const grupo = (mapa: Map<string, Grupo>, chave: string) => {
    let g = mapa.get(chave);
    if (!g) mapa.set(chave, (g = vazio()));
    return g;
  };

  for (const v of vendas) {
    faturamentoCents += v.totalCents;
    const local = new Date(v.criadaEm.getTime() + FUSO_MS);
    somar(grupo(porForma, v.forma), v.totalCents);
    somar(porHora[local.getUTCHours()], v.totalCents);
    somar(porDiaSemana[local.getUTCDay()], v.totalCents);
    somar(grupo(porDia, local.toISOString().slice(0, 10)), v.totalCents);

    const nascimento = nascimentoPorVenda.get(v.codigo);
    somar(grupo(porFaixa, nascimento ? faixaDe(idadeEm(nascimento, local)) : SEM_ID), v.totalCents);

    for (const i of v.itens) {
      const chave = i.ean ?? `nome:${i.nome}`;
      const acumulado = itens.get(chave) ?? { nome: i.nome, ean: i.ean, quantidade: 0, totalCents: 0 };
      acumulado.quantidade += i.quantidade;
      acumulado.totalCents += i.quantidade * i.precoUnitCents;
      itens.set(chave, acumulado);
    }
  }

  return {
    periodo,
    faturamentoCents,
    vendas: vendas.length,
    ticketMedioCents: vendas.length ? Math.round(faturamentoCents / vendas.length) : 0,
    porForma: [...porForma].map(([forma, g]) => ({ forma, ...g })).sort((a, b) => b.totalCents - a.totalCents),
    maisVendidos: [...itens.values()].sort((a, b) => b.quantidade - a.quantidade).slice(0, 10),
    porHora: porHora.map((g, hora) => ({ hora, ...g })),
    porDiaSemana: porDiaSemana.map((g, i) => ({ dia: DIAS[i], ...g })),
    porDia: [...porDia].map(([dia, g]) => ({ dia, ...g })).sort((a, b) => a.dia.localeCompare(b.dia)),
    faixaEtaria: [...FAIXAS, SEM_ID]
      .filter((f) => porFaixa.has(f))
      .map((faixa) => ({ faixa, ...porFaixa.get(faixa)! })),
  };
}
