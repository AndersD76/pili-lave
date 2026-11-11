import { prisma } from "./prisma";

/**
 * Etapas da lavagem em andamento, para o cliente acompanhar pelo celular.
 *
 * A máquina (via display → câmera → heartbeat) só diz QUAL processo está rodando (`proc`). Quem sabe a SEQUÊNCIA de cada modelo é o firmware
 * (g_modelos em testes/w1_w2_por_rxtx/waveshare1/tipos_w1.h) — a mesma lista está aqui; se mudar lá, mude aqui. O modelo 1..4 é o próprio
 * programId da reserva. Como o mesmo processo pode repetir na sequência (ex.: Espuma duas vezes), a posição atual é um PONTEIRO que só avança:
 * quando chega um `proc` diferente do da posição atual, vai para a próxima posição da lista com esse processo.
 */
export const PROC_NOME: Record<number, string> = {
  1: "Enxágue",
  3: "Espuma",
  4: "Espuma",
  5: "Cor mágica",
  6: "Cera",
  7: "Jato de alta pressão",
  8: "Secagem",
  9: "Enxágue",
};

/** Sequência PADRÃO (a de fábrica do firmware). A real vem do display (`/api/machine/sequencia`, evento `sequencia_modelo`) sempre que alguém a altera
 *  na Configuração ou ao ligar; este padrão só vale enquanto a máquina nunca informou a dela. Processos de cada modelo, na ordem (ids do firmware: 1 pré-lavagem/enxágue, 3 espuma A, 5 cor mágica, 6 cera d'água, 7 alta pressão, 8 secagem). */
export const SEQUENCIA: Record<number, number[]> = {
  1: [5, 7],
  2: [3, 5, 7, 3, 5, 7, 6, 1, 8],
  3: [3, 5, 7, 3, 5, 7, 3, 5, 7, 6, 1, 8],
  4: [3, 5, 7, 6, 1, 8],
};

export type EtapasLavagem = { itens: string[]; atual: number | null };

/** Sequência do modelo NESTA máquina: a última que o display informou; senão o padrão de fábrica. */
export async function sequenciaDoModelo(machineId: string | null, modelo: number): Promise<number[] | null> {
  if (machineId) {
    const e = await prisma.event.findFirst({
      where: { type: "sequencia_modelo", AND: [{ payload: { path: ["machineId"], equals: machineId } }, { payload: { path: ["modelo"], equals: modelo } }] },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    const seq = (e?.payload as { seq?: unknown } | null)?.seq;
    if (Array.isArray(seq) && seq.length > 0 && seq.every((p) => typeof p === "number")) return seq as number[];
  }
  return SEQUENCIA[modelo] ?? null;
}

/** Posição que o processo `proc` ocupa na sequência, partindo da posição `atual` (null = ainda não começou). null = não se aplica. */
export function proximaPosicao(seq: number[], atual: number | null, proc: number): number | null {
  if (atual !== null && seq[atual] === proc) return atual;           // continua na mesma etapa
  for (let j = (atual ?? -1) + 1; j < seq.length; j++) if (seq[j] === proc) return j;   // avançou
  return null;                                                        // processo que não está mais adiante: ignora (não volta atrás)
}

async function ultimaPosicao(reservationId: string): Promise<number | null> {
  const e = await prisma.event.findFirst({
    where: { type: "lavagem_etapa", payload: { path: ["reservationId"], equals: reservationId } },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  const idx = (e?.payload as { idx?: number } | null)?.idx;
  return typeof idx === "number" ? idx : null;
}

/** Chamado pelo heartbeat: registra a mudança de etapa da lavagem em andamento nesta máquina (1 evento por mudança, não por batida). */
export async function registrarEtapa(machineId: string, proc: number): Promise<void> {
  if (!proc) return;
  const r = await prisma.reservation.findFirst({
    where: { machineId, status: "ENTERED" },
    select: { id: true, programId: true },
  });
  if (!r) return;
  const seq = await sequenciaDoModelo(machineId, r.programId);
  if (!seq) return;
  const atual = await ultimaPosicao(r.id);
  const nova = proximaPosicao(seq, atual, proc);
  if (nova === null || nova === atual) return;
  await prisma.event.create({
    data: { type: "lavagem_etapa", payload: { reservationId: r.id, idx: nova, proc, programId: r.programId } },
  });
}

/** Lista de etapas e a posição atual, para o app. Sem sequência conhecida (programa novo): null. */
export async function etapasDaReserva(reservationId: string, programId: number, machineId: string | null): Promise<EtapasLavagem | null> {
  const seq = await sequenciaDoModelo(machineId, programId);
  if (!seq) return null;
  return { itens: seq.map((p) => PROC_NOME[p] ?? "Etapa"), atual: await ultimaPosicao(reservationId) };
}
