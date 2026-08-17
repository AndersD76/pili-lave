import { prisma } from "./prisma";
import { ARRIVAL_TTL_MIN } from "./device";
import { plateCandidates } from "./placa";
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
export async function handlePlateRead(plate: string): Promise<PlateReadResult> {
  await expireStale();

  const machine = await defaultMachine();
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
