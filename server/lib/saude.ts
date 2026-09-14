/**
 * Saúde da operação: por que a máquina está (ou não) disponível.
 *
 * Três coisas precisam estar vivas para uma lavagem acontecer:
 *  1. o DISPLAY, que executa o ciclo e reporta falha de sensor/inversor;
 *  2. a CÂMERA, que reconhece a placa na chegada;
 *  3. a INTERNET da máquina — se ela cai, display e câmera somem juntos.
 *
 * O app usa isto para não deixar o cliente pagar por uma lavagem que a
 * máquina não vai executar; o painel do admin usa para alertar.
 */
import { prisma } from "./prisma";
import { HEARTBEAT_OFFLINE_S, machineAvailability } from "./reservations";
import { avisarAdmins } from "./push";

/** Sem foto por este tempo = câmera caiu (ela manda ~1 a cada 8s). */
export const CAMERA_OFFLINE_S = 180;

export type Diagnostico = {
  disponivel: boolean;
  /** Mensagem pronta para o cliente. null quando está tudo certo. */
  motivo: string | null;
  /** Detalhe técnico para o admin. */
  detalhe: string | null;
  problemas: ("MAQUINA_FALHA" | "MAQUINA_MANUTENCAO" | "DISPLAY_OFFLINE" | "CAMERA_OFFLINE")[];
  maquinaStatus: string;
  displaySegundos: number | null;
  cameraSegundos: number | null;
};

const AVISO_PADRAO = "Máquina não disponível no momento. Tente novamente em alguns minutos.";

export async function diagnosticar(): Promise<Diagnostico> {
  const m = await prisma.machine.findFirst({ orderBy: { createdAt: "asc" } });
  const ultimaFoto = await prisma.capture.findFirst({
    orderBy: { at: "desc" },
    select: { at: true },
  });

  const agora = Date.now();
  const displaySegundos = m?.lastHeartbeat
    ? Math.round((agora - m.lastHeartbeat.getTime()) / 1000)
    : null;
  const cameraSegundos = ultimaFoto
    ? Math.round((agora - ultimaFoto.at.getTime()) / 1000)
    : null;

  const problemas: Diagnostico["problemas"] = [];
  if (m?.status === "FAULT") problemas.push("MAQUINA_FALHA");
  if (m?.status === "MAINTENANCE") problemas.push("MAQUINA_MANUTENCAO");
  if (displaySegundos === null || displaySegundos > HEARTBEAT_OFFLINE_S) problemas.push("DISPLAY_OFFLINE");
  if (cameraSegundos === null || cameraSegundos > CAMERA_OFFLINE_S) problemas.push("CAMERA_OFFLINE");

  // A câmera fora do ar não impede lavar: o cliente pode pedir pelo app
  // ("cheguei"). O que impede é a máquina em falha/manutenção ou o display mudo.
  const impeditivo =
    problemas.includes("MAQUINA_FALHA") ||
    problemas.includes("MAQUINA_MANUTENCAO") ||
    problemas.includes("DISPLAY_OFFLINE");

  let motivo: string | null = null;
  if (problemas.includes("MAQUINA_MANUTENCAO")) motivo = "Máquina em manutenção. Voltamos já.";
  else if (problemas.includes("MAQUINA_FALHA"))
    motivo = "A máquina apresentou uma falha e está parada. Já avisamos a equipe.";
  else if (problemas.includes("DISPLAY_OFFLINE")) motivo = AVISO_PADRAO;

  const detalhes: string[] = [];
  if (problemas.includes("MAQUINA_FALHA")) detalhes.push("máquina em FAULT");
  if (problemas.includes("MAQUINA_MANUTENCAO")) detalhes.push("máquina em manutenção");
  if (problemas.includes("DISPLAY_OFFLINE"))
    detalhes.push(`display sem contato há ${displaySegundos === null ? "sempre" : displaySegundos + "s"}`);
  if (problemas.includes("CAMERA_OFFLINE"))
    detalhes.push(`câmera sem enviar fotos há ${cameraSegundos === null ? "sempre" : cameraSegundos + "s"}`);

  return {
    disponivel: !impeditivo,
    motivo,
    detalhe: detalhes.length ? detalhes.join("; ") : null,
    problemas,
    maquinaStatus: m ? machineAvailability(m) : "DOWN",
    displaySegundos,
    cameraSegundos,
  };
}

/**
 * Registra um alerta para o admin (aparece no painel). Não repete o mesmo
 * problema em menos de 10 min — senão o painel vira uma parede de repetição
 * enquanto o problema durar.
 */
const JANELA_REPETICAO_MS = 10 * 60_000;

export async function alertarAdmin(tipo: string, mensagem: string, extra?: unknown) {
  /* Procura ESTE tipo na janela — antes olhava só o alerta mais recente, e
   * dois problemas simultâneos (display + câmera) se anulavam: cada um via o
   * outro no topo e gravava de novo a cada verificação. */
  const desde = new Date(Date.now() - JANELA_REPETICAO_MS);
  const recentes = await prisma.event.findMany({
    where: { type: "alerta_admin", createdAt: { gte: desde } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  if (recentes.some((e) => (e.payload as { tipo?: string } | null)?.tipo === tipo)) return;

  await prisma.event.create({
    data: { type: "alerta_admin", payload: { tipo, mensagem, extra: extra ?? null } as object },
  });
  console.error(`[ALERTA ADMIN] ${tipo}: ${mensagem}`);
  // no painel já aparece; o push é para o admin saber sem estar olhando
  void avisarAdmins({ titulo: "PILI LAVE — alerta", corpo: mensagem, url: "/admin", tag: `alerta-${tipo}` });
}

/** Verifica a saúde e alerta o admin quando houver problema. */
export async function verificarEAlertar(): Promise<Diagnostico> {
  const d = await diagnosticar();
  if (d.problemas.includes("MAQUINA_FALHA"))
    await alertarAdmin("MAQUINA_FALHA", "A máquina reportou falha e parou.", d.detalhe);
  if (d.problemas.includes("DISPLAY_OFFLINE"))
    await alertarAdmin(
      "DISPLAY_OFFLINE",
      "O display parou de se comunicar (queda de internet ou energia na máquina).",
      d.detalhe
    );
  if (d.problemas.includes("CAMERA_OFFLINE"))
    await alertarAdmin(
      "CAMERA_OFFLINE",
      "A câmera parou de enviar fotos — o reconhecimento de placa está fora.",
      d.detalhe
    );
  return d;
}
