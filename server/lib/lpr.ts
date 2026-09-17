import { Machine } from "@prisma/client";
import { prisma } from "./prisma";
import { avisarCliente } from "./push";
import { ARRIVAL_TTL_MIN } from "./device";
import { normalizePlate, plateCandidates, plateDistance } from "./placa";
import {
  LightState,
  QUEUE_FREEZE_MIN,
  defaultMachine,
  expireStale,
  machineAvailability,
  setTransientLight,
} from "./reservations";

export type PlateReadResult = {
  arrivalId: string | null;
  status: string;
  match: boolean;
  clientName: string | null;
  saldoOk: boolean;           // legado (fluxo por Arrival sem reserva)
  light: LightState;
  reservation: null | { id: string; status: string; programId: number; programa: string };
  machineState: string;
  dedup?: boolean;
};

/**
 * Decisão central da chegada (matriz reserva × máquina):
 *  - reserva HELD válida + máquina LIVRE   → ACTIVE, verde sólido (pode entrar)
 *  - reserva HELD válida + máquina LAVANDO → segue HELD, verde piscando (fila;
 *    congela o relógio da reserva — espera por culpa da operação não a queima)
 *  - reserva HELD válida + máquina FALHA/OFFLINE/MANUTENÇÃO → vermelho piscando
 *  - placa cadastrada sem reserva → alterna verde/vermelho (reserve no app)
 *  - placa desconhecida → vermelho sólido
 * Sem cancela: a luz é a única barreira. Verde sólido NUNCA sem máquina
 * confirmada livre (heartbeat < 60s).
 */
export async function handlePlateRead(plate: string, machineOverride?: Machine): Promise<PlateReadResult> {
  await expireStale();

  // machineOverride: usado pela liberação manual ("cheguei") quando a
  // reserva pertence a uma unidade com mais de uma máquina e o cliente já
  // disse em qual está — sem isso caía sempre na primeira máquina do banco.
  const machine = machineOverride ?? await defaultMachine();
  const avail = machineAvailability(machine);

  // matching tolerante: OCR/digitação confundem O↔0, I↔1, B↔8 etc. —
  // procura a leitura crua E as correções de sósia por posição
  const candidates = plateCandidates(plate);
  const vehicle = await prisma.vehicle.findFirst({
    where: { plate: { in: candidates.length ? candidates : [plate] } },
    orderBy: { createdAt: "desc" },
    include: { user: true },
  });
  if (vehicle) plate = vehicle.plate; // usa a placa cadastrada como canônica

  // ── placa desconhecida ─────────────────────────────────────────────
  if (!vehicle) {
    await setTransientLight(machine.id, "RED_SOLID");
    const arrival = await prisma.arrival.create({
      data: { plate, status: "NO_MATCH", stationId: machine.stationId },
    });
    await prisma.event.create({
      data: { type: "lpr_read", payload: { plate, match: false, arrivalId: arrival.id } },
    });
    return {
      arrivalId: arrival.id, status: "NO_MATCH", match: false, clientName: null,
      saldoOk: false, light: "RED_SOLID", reservation: null, machineState: avail,
    };
  }

  // ── reserva válida? ────────────────────────────────────────────────
  const reservation = await prisma.reservation.findFirst({
    where: {
      vehicleId: vehicle.id,
      status: { in: ["HELD", "ACTIVE", "ENTERED"] },
      expiresAt: { gt: new Date() },
    },
    include: { program: true },
    orderBy: { createdAt: "asc" },
  });

  let light: LightState;
  let arrivalStatus: "WAITING_DRIVER" | "REQUESTED" = "WAITING_DRIVER";

  if (reservation) {
    if (reservation.status === "ENTERED") {
      light = "OFF"; // carro já está dentro; leitura repetida da câmera
    } else if (reservation.status === "ACTIVE") {
      light = avail === "DOWN" ? "RED_BLINK" : "GREEN_SOLID"; // idempotente
      arrivalStatus = "REQUESTED";
    } else if (avail === "FREE") {
      // HELD → ACTIVE: aloca a máquina e acende o verde
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: {
          status: "ACTIVE",
          machineId: machine.id,
          stationId: machine.stationId,
          activeAt: new Date(),
        },
      });
      light = "GREEN_SOLID";
      arrivalStatus = "REQUESTED";
      // o cliente não fica olhando a tela: avisa no celular
      void avisarCliente(reservation.userId, {
        titulo: "Pode entrar!",
        corpo: `${vehicle.plate} reconhecida — luz verde acesa. Boa lavagem!`,
        tag: "lavagem",
      });
    } else if (avail === "WASHING") {
      // fila: mantém HELD e congela o relógio da reserva
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { expiresAt: new Date(Date.now() + QUEUE_FREEZE_MIN * 60_000) },
      });
      light = "GREEN_BLINK";
    } else {
      light = "RED_BLINK"; // máquina em falha/offline/manutenção
    }
  } else {
    // cadastrado, sem reserva — fluxo legado por Arrival continua valendo
    light = avail === "DOWN" ? "RED_BLINK" : "RED_GREEN_ALT";
  }

  if (light !== "OFF") await setTransientLight(machine.id, light);

  // ── Arrival p/ visibilidade no app (deduplicado) ───────────────────
  const cutoff = new Date(Date.now() - ARRIVAL_TTL_MIN * 60_000);
  await prisma.arrival.updateMany({
    where: { status: "WAITING_DRIVER", createdAt: { lt: cutoff } },
    data: { status: "EXPIRED" },
  });
  let arrival = await prisma.arrival.findFirst({
    where: { plate, status: { in: ["WAITING_DRIVER", "REQUESTED"] }, createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
  });
  const dedup = !!arrival;
  if (!arrival) {
    arrival = await prisma.arrival.create({
      data: {
        plate,
        vehicleId: vehicle.id,
        userId: vehicle.userId,
        status: arrivalStatus,
        reservationId: reservation?.id ?? null,
        stationId: machine.stationId,
        requestedAt: arrivalStatus === "REQUESTED" ? new Date() : null,
      },
    });
    await prisma.event.create({
      data: {
        type: "lpr_read",
        payload: { plate, match: true, arrivalId: arrival.id, reservationId: reservation?.id ?? null, light },
      },
    });
  }

  // legado: app antigo mostra "sem saldo" quando não há reserva
  const menor = await prisma.program.findFirst({ where: { ativo: true }, orderBy: { precoCents: "asc" } });
  const saldoOk = !!menor && vehicle.user.walletCents >= menor.precoCents;

  return {
    arrivalId: arrival.id,
    status: arrival.status,
    match: true,
    clientName: vehicle.user.name ?? null,
    saldoOk,
    light,
    reservation: reservation
      ? { id: reservation.id, status: reservation.status, programId: reservation.programId, programa: reservation.program.nome }
      : null,
    machineState: avail,
    dedup: dedup || undefined,
  };
}

const SUGGEST_MAX_DIST = 2;     // até 2 caracteres diferentes ainda conta como "pode ser esse"
const SUGGEST_DEDUP_MIN = 2;    // não recria sugestão a cada frame novo

export type SuggestResult = { arrivalId: string; plate: string; matchScore: number };

/**
 * Leitura de placa FRACA (não passou no corte de auto-aceite): em vez de
 * jogar fora, compara com quem já pagou e está na fila (reserva HELD) nesta
 * estação. Se bater com EXATAMENTE UM veículo (folga de até 2 caracteres —
 * cobre sósias de OCR), cria uma chegada "SUGESTÃO" para o dono confirmar no
 * app ("é o seu carro?"). Nunca libera nada sozinho: só a confirmação do
 * motorista promove a reserva (ver /api/arrivals/[id]/confirm).
 */
export async function suggestFromWeakRead(rawPlate: string, score: number): Promise<SuggestResult | null> {
  const guess = normalizePlate(rawPlate);
  const held = await prisma.reservation.findMany({
    where: { status: "HELD", expiresAt: { gt: new Date() } },
    include: { vehicle: true },
  });
  const matches = held.filter((r) => plateDistance(guess, r.vehicle.plate) <= SUGGEST_MAX_DIST);
  if (matches.length !== 1) return null; // nenhum ou ambíguo demais — não arrisca
  const [hit] = matches;

  const cutoff = new Date(Date.now() - SUGGEST_DEDUP_MIN * 60_000);
  const existing = await prisma.arrival.findFirst({
    where: { reservationId: hit.id, status: "SUGGESTED", createdAt: { gte: cutoff } },
  });
  if (existing) return { arrivalId: existing.id, plate: hit.vehicle.plate, matchScore: score };

  const machine = await defaultMachine();
  const arrival = await prisma.arrival.create({
    data: {
      plate: hit.vehicle.plate,
      vehicleId: hit.vehicleId,
      userId: hit.userId,
      reservationId: hit.id,
      stationId: machine.stationId,
      status: "SUGGESTED",
      matchScore: score,
    },
  });
  await prisma.event.create({
    data: {
      type: "lpr_suggested",
      payload: { plate: hit.vehicle.plate, guess, score, reservationId: hit.id, arrivalId: arrival.id },
    },
  });
  return { arrivalId: arrival.id, plate: hit.vehicle.plate, matchScore: score };
}
