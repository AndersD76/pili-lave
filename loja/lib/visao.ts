import { criarAlerta, lerLista } from "./alertas";
import { gravarConfig, lerConfig } from "./config";
import { prisma } from "./prisma";
import { reposicaoAtiva } from "./visitas";

/* O que chega das câmeras (programa em visao/) e a auditoria em cima disso.
 * A regra não depende de saber com certeza quem pegou cada item:
 *  - uma visita só na zona → o evento é dela;
 *  - duas ou mais → fica ambíguo;
 *  - durante uma reposição → é de quem está repondo, e não conta;
 *  - quando a loja esvazia, fecha-se o período: o que saiu das prateleiras
 *    tem que bater com o que foi pago. Não bateu → Divergencia, pro dono. */

export const TIPOS_EVENTO = ["PRATELEIRA", "PORTA", "CAMERA"] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

export type EventoRecebido = {
  tipo: TipoEvento; zona?: string | null;
  /** PRATELEIRA: negativo = saiu da prateleira. PORTA: +1 entrou, -1 saiu. */
  delta?: number;
  visitasNaZona?: string[]; ambiguo?: boolean; imagens?: string[]; detalhe?: string | null;
  ocorridoEm?: Date;
};

/** Depois que o último cliente sai, espera isto antes de fechar o período:
 *  dá tempo de chegar o evento de prateleira que a câmera ainda processava. */
const CARENCIA_MS = 30 * 1000;
const MAX_IMAGENS = 10;

export async function registrarEvento(e: EventoRecebido) {
  const visitasNaZona = (e.visitasNaZona ?? []).slice(0, 10);
  const imagens = (e.imagens ?? []).slice(0, MAX_IMAGENS);
  const ocorridoEm = e.ocorridoEm ?? new Date();

  const evento = await prisma.$transaction(async (tx) => {
    const reposicao = await reposicaoAtiva(tx);
    const ativas = await tx.visita.findMany({ where: { saiuEm: null }, select: { id: true } });

    let visitaId: string | null = null;
    let ambiguo = false;
    if (e.tipo === "PRATELEIRA" && !reposicao) {
      const naZona = visitasNaZona.filter((id) => ativas.some((v) => v.id === id));
      if (naZona.length === 1) visitaId = naZona[0];
      else if (naZona.length >= 2 || e.ambiguo) ambiguo = true;
      // a câmera não soube dizer quem estava na zona, mas só há uma pessoa na loja
      else if (ativas.length === 1) visitaId = ativas[0].id;
      else if (ativas.length >= 2) ambiguo = true;
    }

    const criado = await tx.eventoVisao.create({
      data: {
        tipo: e.tipo, zona: e.zona || null, delta: Math.trunc(e.delta ?? 0),
        visitasNaZona: JSON.stringify(visitasNaZona), ambiguo, visitaId,
        reposicaoId: reposicao?.id ?? null, imagens: JSON.stringify(imagens),
        detalhe: e.detalhe || null, ocorridoEm,
      },
    });

    // alguém entrou sem entrada liberada: ou a loja estava vazia, ou a câmera
    // já conferiu que o rastro não bate com nenhuma visita (detalhe INVASAO)
    if (e.tipo === "PORTA" && (e.delta ?? 0) > 0 && (ativas.length === 0 || e.detalhe === "INVASAO") && !reposicao)
      await criarAlerta(tx, {
        tipo: "INVASAO", titulo: "Entrada não autorizada",
        detalhe: `As câmeras viram alguém entrar na loja sem entrada liberada${e.detalhe ? ` — ${e.detalhe}` : ""}.`,
        imagens, ocorridoEm,
      });
    return criado;
  });

  return { eventoId: evento.id, ambiguo: evento.ambiguo, visitaId: evento.visitaId, emReposicao: evento.reposicaoId !== null };
}

/**
 * Fechamento do período, se a loja estiver vazia. Chamado de tempos em
 * tempos (instrumentation.ts). Devolve a divergência criada, ou null quando
 * não havia o que fechar ou o período bateu.
 *
 * Só há comparação quando as câmeras registraram algo no período: sem
 * nenhum evento de prateleira não dá pra afirmar nada (câmeras ainda não
 * instaladas ou fora do ar) e nenhuma divergência é criada.
 */
export async function fecharPeriodo(opcoes: { semCarencia?: boolean } = {}) {
  if ((await prisma.visita.count({ where: { saiuEm: null } })) > 0) return null;
  if (await reposicaoAtiva()) return null;

  const fim = new Date();
  if (!opcoes.semCarencia) {
    const ultima = await prisma.visita.findFirst({ where: { saiuEm: { not: null } }, orderBy: { saiuEm: "desc" }, select: { saiuEm: true } });
    if (ultima?.saiuEm && fim.getTime() - ultima.saiuEm.getTime() < CARENCIA_MS) return null;
  }

  const marca = await lerConfig("ultimoFechamento");
  let inicio = marca ? new Date(marca) : null;
  if (!inicio) {
    // primeiro fechamento da vida da loja: o período começa na primeira
    // entrada ou no primeiro evento das câmeras — as vendas de antes de
    // existir porta e câmera não entram na conta
    const [visita, evento] = await Promise.all([
      prisma.visita.findFirst({ orderBy: { entrouEm: "asc" }, select: { entrouEm: true } }),
      prisma.eventoVisao.findFirst({ orderBy: { criadoEm: "asc" }, select: { criadoEm: true } }),
    ]);
    const primeiro = Math.min(visita?.entrouEm.getTime() ?? Infinity, evento?.criadoEm.getTime() ?? Infinity);
    if (!Number.isFinite(primeiro)) return null;
    inicio = new Date(primeiro - 1);
  }

  // pelo momento em que o evento CHEGOU (criadoEm), não pelo que a câmera
  // carimbou: evento atrasado entra no período seguinte em vez de se perder
  const eventos = await prisma.eventoVisao.findMany({
    where: { tipo: "PRATELEIRA", divergenciaId: null, reposicaoId: null, criadoEm: { gt: inicio, lte: fim } },
    orderBy: { ocorridoEm: "asc" },
  });
  if (eventos.length === 0) {
    // nada a comparar; avança a marca só se houve movimento, pra não gravar à toa
    if ((await prisma.visita.count({ where: { saiuEm: { gt: inicio } } })) > 0) await gravarConfig({ ultimoFechamento: fim.toISOString() });
    return null;
  }

  const [itensPagos, visitas] = await Promise.all([
    prisma.vendaItem.aggregate({
      where: { venda: { criadaEm: { gt: inicio, lte: fim }, canceladaEm: null } }, _sum: { quantidade: true },
    }),
    prisma.visita.findMany({ where: { saiuEm: { gt: inicio } }, select: { id: true, nome: true, codigoCliente: true } }),
  ]);
  const saiuPrateleira = -eventos.reduce((s, ev) => s + ev.delta, 0);
  const pago = itensPagos._sum.quantidade ?? 0;

  const divergencia = await prisma.$transaction(async (tx) => {
    await tx.config.upsert({
      where: { chave: "ultimoFechamento" }, update: { valor: fim.toISOString() },
      create: { chave: "ultimoFechamento", valor: fim.toISOString() },
    });
    if (saiuPrateleira === pago) return null;

    const d = await tx.divergencia.create({
      data: {
        inicio, fim, saiuPrateleira, pago,
        visitas: JSON.stringify(visitas.map((v) => ({ visitaId: v.id, nome: v.nome, codigoCliente: v.codigoCliente }))),
      },
    });
    await tx.eventoVisao.updateMany({ where: { id: { in: eventos.map((ev) => ev.id) } }, data: { divergenciaId: d.id } });
    const quem = visitas.length > 0 ? ` Na loja no período: ${visitas.map((v) => v.nome).join(", ")}.` : " Ninguém com entrada registrada no período.";
    await criarAlerta(tx, {
      tipo: "DIVERGENCIA", titulo: "Divergência de estoque",
      detalhe: `Saíram ${saiuPrateleira} unidade(s) das prateleiras e foram pagas ${pago}.${quem} Confira as imagens na gestão da loja.`,
      imagens: eventos.flatMap((ev) => lerLista(ev.imagens)), ocorridoEm: fim,
    });
    return d;
  });
  return divergencia;
}
