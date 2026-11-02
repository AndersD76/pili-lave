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
import { avisarAdmins, avisarCliente } from "./push";

/** Sem foto por este tempo = câmera caiu (ela manda ~1 a cada 8s). */
export const CAMERA_OFFLINE_S = 180;

export type Diagnostico = {
  disponivel: boolean;
  /** LIVRE | LAVANDO | PARADA — o que mostrar ao cliente. */
  estado: "LIVRE" | "LAVANDO" | "PARADA";
  /** Segundos estimados até a máquina liberar (só quando LAVANDO). */
  liberaEmSeg: number | null;
  /** Quantos já pagaram e estão esperando a vez. */
  naFila: number;
  /** Mensagem pronta para o cliente. null quando está tudo certo. */
  motivo: string | null;
  /** Detalhe técnico para o admin. */
  detalhe: string | null;
  problemas: ("MAQUINA_FALHA" | "MAQUINA_MANUTENCAO" | "DISPLAY_OFFLINE" | "CAMERA_OFFLINE")[];
  maquinaStatus: string;
  displaySegundos: number | null;
  cameraSegundos: number | null;
  /** Máquina diagnosticada e o lavador dela (se houver) — pra avisar só quem cuida dela. */
  machineId: string | null;
  operadorId: string | null;
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

  /* Quanto falta para liberar. Duas fontes, nesta ordem:
   *  1. o que a MÁQUINA reporta (remainingSec do heartbeat) — é o real;
   *  2. a duração do programa menos o tempo já decorrido — estimativa.
   * A duração cadastrada é conservadora (um ciclo "Simples" de 15 min
   * levou 7 na prática), então o número é um teto, não uma promessa. */
  const lavando = await prisma.reservation.findFirst({
    where: { status: "ENTERED" },
    include: { program: true },
    orderBy: { enteredAt: "asc" },
  });
  let liberaEmSeg: number | null = null;
  if (lavando?.enteredAt) {
    const decorrido = Math.round((agora - lavando.enteredAt.getTime()) / 1000);
    const total = (lavando.program.duracaoMin || 15) * 60;
    liberaEmSeg = m?.remainingSec && m.remainingSec > 0
      ? m.remainingSec
      : Math.max(0, total - decorrido);
  }
  const naFila = await prisma.reservation.count({ where: { status: "HELD" } });

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

  /* Ocupada também quando o sensor acusa carro sob a máquina, mesmo sem
   * reserva nossa — carro que entrou sem pagar ou teste do operador. Sem
   * isto o app diria "livre" com um carro parado lá dentro. */
  /* Só conta como ocupada depois que o sensor acusa carro por 15s — o X15
   * pisca 0/1 e, sem isso, o app alternaria "ocupada"/"livre" na frente do
   * cliente a cada batida do heartbeat. */
  const SENSOR_ESTAVEL_MS = 15_000;
  const carroNaMaquina =
    (m?.sensorX14 === true || m?.sensorX15 === true) &&
    (!m?.sensorDesde || agora - m.sensorDesde.getTime() >= SENSOR_ESTAVEL_MS);
  const estado: Diagnostico["estado"] = impeditivo
    ? "PARADA"
    : m?.status === "WASHING" || lavando || carroNaMaquina
      ? "LAVANDO"
      : "LIVRE";

  return {
    disponivel: !impeditivo,
    estado,
    liberaEmSeg,
    naFila,
    motivo,
    detalhe: detalhes.length ? detalhes.join("; ") : null,
    problemas,
    maquinaStatus: m ? machineAvailability(m) : "DOWN",
    displaySegundos,
    cameraSegundos,
    machineId: m?.id ?? null,
    operadorId: m?.operadorId ?? null,
  };
}

/**
 * Alertas para o admin (aparecem no painel e viram push no celular).
 *
 * Dois comportamentos:
 *  - EVENTO (padrão, ex.: carro não chegou no X15): cada ocorrência avisa, mas sem repetir o mesmo aviso em menos de 10 min.
 *  - PERSISTENTE (display fora, câmera fora, máquina em falha): avisa UMA vez quando o problema começa e UMA vez quando ele acaba
 *    ("voltou"). Enquanto durar, não repete (2026-11-02): antes repetia a cada ~10 min e poluía o painel e o celular.
 *    O estado vem dos próprios eventos: o último de "alerta_admin"/"alerta_resolvido" para aquele tipo+máquina. Sem tabela nova.
 */
const JANELA_REPETICAO_MS = 10 * 60_000;
const TIPOS_ESTADO = ["alerta_admin", "alerta_resolvido"];

type EventoAlerta = { type: string; createdAt: Date; payload: unknown };

/** Alertas recentes (30 dias), mais novos primeiro: uma consulta só para toda a verificação. */
async function alertasRecentes(): Promise<EventoAlerta[]> {
  return prisma.event.findMany({
    where: { type: { in: TIPOS_ESTADO }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    take: 150,
  });
}

function ultimoDe(recentes: EventoAlerta[], tipo: string, machineId: string | null | undefined): EventoAlerta | undefined {
  return recentes.find((e) => {
    const p = e.payload as { tipo?: string; machineId?: string | null } | null;
    return p?.tipo === tipo && (p?.machineId ?? "") === (machineId ?? "");
  });
}

export async function alertarAdmin(
  tipo: string,
  mensagem: string,
  extra?: unknown,
  machineId?: string | null,
  operadorId?: string | null,
  persistente = false,
  recentesJa?: EventoAlerta[]
) {
  const recentes = recentesJa ?? (await alertasRecentes());
  const ultimo = ultimoDe(recentes, tipo, machineId);
  if (persistente) {
    // ainda aberto (o último registro é o aviso, sem "voltou" depois): não repete
    if (ultimo?.type === "alerta_admin") return;
  } else if (ultimo?.type === "alerta_admin" && Date.now() - ultimo.createdAt.getTime() < JANELA_REPETICAO_MS) {
    return;
  }

  const criado = await prisma.event.create({
    data: { type: "alerta_admin", payload: { tipo, mensagem, extra: extra ?? null, machineId: machineId ?? null, persistente } as object },
  });
  recentes.unshift({ type: "alerta_admin", createdAt: criado.createdAt, payload: criado.payload });
  console.error(`[ALERTA ADMIN] ${tipo}: ${mensagem}`);
  // no painel já aparece; o push é para alguém saber sem estar olhando
  void avisarAdmins({ titulo: "PILI CLEAN — alerta", corpo: mensagem, url: "/admin", tag: `alerta-${tipo}-${machineId ?? ""}` });
  // Lavador responsável por ESTA máquina também é avisado — é ele quem
  // toma a providência no local; o admin nem sempre está por perto.
  if (operadorId)
    void avisarCliente(operadorId, { titulo: "Sua máquina precisa de atenção", corpo: mensagem, url: "/app", tag: `alerta-${tipo}` });
}

/** O problema acabou: se havia um aviso aberto, registra UM "voltou" e avisa no celular. Sem aviso aberto, não faz nada. */
export async function resolverAlerta(
  tipo: string,
  mensagem: string,
  machineId?: string | null,
  operadorId?: string | null,
  recentesJa?: EventoAlerta[]
) {
  const recentes = recentesJa ?? (await alertasRecentes());
  const ultimo = ultimoDe(recentes, tipo, machineId);
  if (ultimo?.type !== "alerta_admin") return; // não havia nada aberto
  const minutos = Math.max(1, Math.round((Date.now() - ultimo.createdAt.getTime()) / 60_000));
  const texto = `${mensagem} (ficou ${minutos < 120 ? `${minutos} min` : `${Math.round(minutos / 60)} h`} com o problema)`;
  const criado = await prisma.event.create({
    data: { type: "alerta_resolvido", payload: { tipo, mensagem: texto, machineId: machineId ?? null, duracaoMin: minutos } as object },
  });
  recentes.unshift({ type: "alerta_resolvido", createdAt: criado.createdAt, payload: criado.payload });
  void avisarAdmins({ titulo: "PILI CLEAN — normalizado", corpo: texto, url: "/admin", tag: `alerta-${tipo}-${machineId ?? ""}` });
  if (operadorId) void avisarCliente(operadorId, { titulo: "Sua máquina voltou ao normal", corpo: texto, url: "/app", tag: `alerta-${tipo}` });
}

/** Verifica a saúde: avisa UMA vez quando o problema começa e UMA vez quando acaba (+ o lavador da máquina). */
export async function verificarEAlertar(): Promise<Diagnostico> {
  const d = await diagnosticar();
  const recentes = await alertasRecentes();
  const checar = async (tipo: string, ativo: boolean, msgProblema: string, msgVoltou: string) => {
    if (ativo) await alertarAdmin(tipo, msgProblema, d.detalhe, d.machineId, d.operadorId, true, recentes);
    else await resolverAlerta(tipo, msgVoltou, d.machineId, d.operadorId, recentes);
  };
  await checar("MAQUINA_FALHA", d.problemas.includes("MAQUINA_FALHA"),
    "A máquina reportou falha e parou.", "A máquina voltou a operar.");
  await checar("DISPLAY_OFFLINE", d.problemas.includes("DISPLAY_OFFLINE"),
    "O display parou de se comunicar (queda de internet ou energia na máquina).", "O display voltou a se comunicar.");
  await checar("CAMERA_OFFLINE", d.problemas.includes("CAMERA_OFFLINE"),
    "A câmera parou de enviar fotos — o reconhecimento de placa está fora.", "A câmera voltou a enviar fotos.");
  return d;
}
