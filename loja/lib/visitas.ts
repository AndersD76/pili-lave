import type { Prisma } from "@prisma/client";
import { criarAlerta } from "./alertas";
import { registrarAtividade } from "./atividade";
import { lerConfig, lojaConfigurada } from "./config";
import type { UsuarioGestao } from "./permissoes";
import { prisma } from "./prisma";

/* Entrada e saída de clientes. É o ÚNICO lugar que decide se alguém entra —
 * a catraca, a trava por BLE ou a gestão só perguntam aqui (rota
 * /api/entrada/autorizar). Não depende de internet: confere a cópia local
 * dos clientes (ClienteLocal). */

export const ORIGENS = ["CATRACA", "BLE", "MANUAL", "REMOTA"] as const;
export type Origem = (typeof ORIGENS)[number];

export type MotivoRecusa = "LOTADO" | "REPOSICAO" | "BLOQUEADO" | "DESCONHECIDO" | "FECHADA";

export const MENSAGEM_RECUSA: Record<MotivoRecusa, string> = {
  LOTADO: "Ocupação máxima esgotada, aguarde",
  REPOSICAO: "Em reposição de estoque. Por favor aguarde um pouco",
  BLOQUEADO: "Sua entrada nesta loja está bloqueada. Fale com o suporte pelo app.",
  DESCONHECIDO: "Cadastro não encontrado. Abra o app Pili e tente de novo.",
  FECHADA: "Loja fechada no momento.",
};

/** Visita sem saída registrada há mais tempo que isso é encerrada sozinha,
 *  pra uma saída que o equipamento não viu não travar a lotação pra sempre. */
const VISITA_MAXIMA_MS = 3 * 60 * 60 * 1000;

export type PedidoEntrada = {
  nuvemUserId?: string; codigoCliente?: string; criancas?: number; origem: Origem;
  /** Só pra origem MANUAL/REMOTA/BLE: entra alguém que ainda não está na
   *  cópia local (ex.: credencial offline assinada, conferida pelo adaptador). */
  nome?: string;
};

export type RespostaEntrada =
  | { liberado: true; mensagem: string; visitaId: string }
  | { liberado: false; motivo: MotivoRecusa; mensagem: string };

function recusa(motivo: MotivoRecusa): RespostaEntrada {
  return { liberado: false, motivo, mensagem: MENSAGEM_RECUSA[motivo] };
}

export function reposicaoAtiva(db: Prisma.TransactionClient | typeof prisma = prisma) {
  return db.reposicao.findFirst({ where: { fim: null }, orderBy: { inicio: "desc" } });
}

export function visitasAtivas(db: Prisma.TransactionClient | typeof prisma = prisma) {
  return db.visita.findMany({ where: { saiuEm: null }, orderBy: { entrouEm: "asc" } });
}

export async function autorizarEntrada(pedido: PedidoEntrada): Promise<RespostaEntrada> {
  const loja = await lojaConfigurada();
  if (!loja || (await lerConfig("lojaAberta")) === "0") return recusa("FECHADA");

  const codigo = pedido.codigoCliente?.replace(/\D/g, "") || undefined;
  if (!pedido.nuvemUserId && !codigo && !pedido.nome) return recusa("DESCONHECIDO");

  // numa transação só: duas pessoas pedindo ao mesmo tempo não passam da lotação
  return prisma.$transaction(async (tx) => {
    const cliente = pedido.nuvemUserId
      ? await tx.clienteLocal.findUnique({ where: { nuvemUserId: pedido.nuvemUserId } })
      : codigo ? await tx.clienteLocal.findUnique({ where: { codigoCliente: codigo } }) : null;

    const nome = cliente?.nome ?? (pedido.origem !== "CATRACA" ? pedido.nome?.trim() : undefined);
    if (!nome) return recusa("DESCONHECIDO");
    if (cliente?.bloqueado) return recusa("BLOQUEADO");

    const nuvemUserId = cliente?.nuvemUserId ?? pedido.nuvemUserId ?? null;
    const codigoCliente = cliente?.codigoCliente ?? codigo ?? null;

    // já está dentro (o equipamento perguntou duas vezes): mesma visita
    if (nuvemUserId) {
      const ja = await tx.visita.findFirst({ where: { nuvemUserId, saiuEm: null } });
      if (ja) return { liberado: true as const, mensagem: `Bem-vindo, ${ja.nome}`, visitaId: ja.id };
    }

    if (await reposicaoAtiva(tx)) return recusa("REPOSICAO");
    if ((await tx.visita.count({ where: { saiuEm: null } })) >= loja.capacidade) return recusa("LOTADO");

    const visita = await tx.visita.create({
      data: {
        nuvemUserId, codigoCliente, nome, origem: pedido.origem,
        criancas: Math.max(0, Math.min(2, Math.trunc(pedido.criancas ?? 0))),
      },
    });
    return { liberado: true as const, mensagem: `Bem-vindo, ${nome}`, visitaId: visita.id };
  });
}

export type RespostaSaida = { ok: true; visitaId: string; saiuSemPagar: boolean } | { ok: false; erro: string };

/**
 * Fecha a visita. Sem venda ligada a ela, fica marcada como "saiu sem
 * pagar" e o dono é avisado — ninguém é barrado nem cobrado por isso.
 * `silenciosa`: encerramento por tempo ou pela gestão, sem aviso.
 */
export async function registrarSaida(
  ref: { visitaId?: string; nuvemUserId?: string },
  opcoes: { silenciosa?: boolean } = {}
): Promise<RespostaSaida> {
  return prisma.$transaction(async (tx) => {
    const visita = ref.visitaId
      ? await tx.visita.findUnique({ where: { id: ref.visitaId } })
      : ref.nuvemUserId
        ? await tx.visita.findFirst({ where: { nuvemUserId: ref.nuvemUserId, saiuEm: null }, orderBy: { entrouEm: "desc" } })
        : null;
    if (!visita) return { ok: false as const, erro: "Visita não encontrada." };
    if (visita.saiuEm) return { ok: true as const, visitaId: visita.id, saiuSemPagar: visita.saiuSemPagar };

    let vendaId = visita.vendaId;
    if (vendaId === null) {
      // pagou no cartão sem se identificar no caixa: se há uma venda feita
      // enquanto ela estava dentro e que não é de nenhuma outra visita, é dela
      const vendas = await tx.venda.findMany({
        where: { criadaEm: { gte: visita.entrouEm }, canceladaEm: null }, orderBy: { id: "asc" }, select: { id: true },
      });
      if (vendas.length > 0) {
        const usadas = new Set(
          (await tx.visita.findMany({ where: { vendaId: { in: vendas.map((v) => v.id) } }, select: { vendaId: true } })).map((v) => v.vendaId)
        );
        vendaId = vendas.find((v) => !usadas.has(v.id))?.id ?? null;
      }
    }

    // quem estava repondo estoque sai sem comprar, e está tudo certo
    const repondo = await tx.reposicao.findFirst({
      where: { OR: [{ fim: null }, { fim: { gte: visita.entrouEm } }] },
    });
    const saiuSemPagar = vendaId === null && !repondo && !opcoes.silenciosa;

    await tx.visita.update({ where: { id: visita.id }, data: { saiuEm: new Date(), vendaId, saiuSemPagar } });
    if (saiuSemPagar)
      await criarAlerta(tx, {
        tipo: "SAIDA_SEM_PAGAR",
        titulo: "Saída sem compra registrada",
        detalhe: `${visita.nome}${visita.codigoCliente ? ` (código ${visita.codigoCliente})` : ""} saiu da loja sem nenhuma compra registrada no caixa.`,
      });
    return { ok: true as const, visitaId: visita.id, saiuSemPagar };
  });
}

/** Chamada pelo caixa ao fechar uma venda: liga a venda à visita indicada
 *  (rosto ou nome escolhido no totem) ou, sem indicação, à única pessoa
 *  que está dentro. Com mais de uma e sem indicação, fica sem ligar. */
export async function ligarVendaAVisita(tx: Prisma.TransactionClient, vendaId: number, visitaId?: string | null) {
  let alvo = visitaId ? await tx.visita.findFirst({ where: { id: visitaId, saiuEm: null } }) : null;
  if (!alvo) {
    const ativas = await tx.visita.findMany({ where: { saiuEm: null }, take: 2 });
    if (ativas.length === 1) alvo = ativas[0];
  }
  if (alvo) await tx.visita.update({ where: { id: alvo.id }, data: { vendaId } });
}

/** Encerra visitas esquecidas abertas (ver VISITA_MAXIMA_MS). */
export async function expirarVisitas(): Promise<number> {
  const velhas = await prisma.visita.findMany({
    where: { saiuEm: null, entrouEm: { lt: new Date(Date.now() - VISITA_MAXIMA_MS) } }, select: { id: true },
  });
  for (const v of velhas) await registrarSaida({ visitaId: v.id }, { silenciosa: true });
  return velhas.length;
}

/* ── Modo reposição ─────────────────────────────────────────────────── */

export async function iniciarReposicao(usuario: UsuarioGestao): Promise<{ ok: true } | { ok: false; erro: string }> {
  return prisma.$transaction(async (tx) => {
    if (await reposicaoAtiva(tx)) return { ok: false as const, erro: "Já existe uma reposição em andamento." };
    await tx.reposicao.create({ data: { usuarioId: usuario.id, usuarioNome: usuario.nome } });
    await registrarAtividade(tx, usuario, "REPOSICAO_INICIADA", "Loja bloqueada para clientes durante a reposição.");
    return { ok: true as const };
  });
}

export async function encerrarReposicao(usuario: UsuarioGestao): Promise<{ ok: true } | { ok: false; erro: string }> {
  return prisma.$transaction(async (tx) => {
    const atual = await reposicaoAtiva(tx);
    if (!atual) return { ok: false as const, erro: "Não há reposição em andamento." };
    const fim = new Date();
    await tx.reposicao.update({ where: { id: atual.id }, data: { fim } });
    const minutos = Math.max(1, Math.round((fim.getTime() - atual.inicio.getTime()) / 60000));
    await registrarAtividade(
      tx, usuario, "REPOSICAO_ENCERRADA",
      `Reposição iniciada por ${atual.usuarioNome} durou ${minutos} min. Loja liberada para clientes.`
    );
    return { ok: true as const };
  });
}
