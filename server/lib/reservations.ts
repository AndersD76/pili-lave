import { Machine, Prisma, Reservation } from "@prisma/client";
import { prisma } from "./prisma";

/** Regras de tempo do fluxo de reserva. */
export const HOLD_TTL_MIN = 60;        // validade da reserva (HELD)
export const ACTIVE_TTL_MIN = 5;       // verde aceso sem X14 → volta a HELD
export const QUEUE_FREEZE_MIN = 15;    // espera na fila estende a validade
export const HEARTBEAT_OFFLINE_S = 60; // sem heartbeat → máquina OFFLINE
export const LIGHT_TRANSIENT_S = 20;   // luz fixada por evento (placa lida etc.)
export const DONE_GREEN_S = 10;        // verde de "pode sair" após concluir

/** Estados possíveis da lâmpada única bicolor. */
export type LightState =
  | "OFF"
  | "GREEN_SOLID"
  | "GREEN_BLINK"
  | "RED_SOLID"
  | "RED_BLINK"
  | "RED_GREEN_ALT";

const ACTIVE_HOLD_STATUSES = ["HELD", "ACTIVE", "ENTERED"] as const;

/** Soma dos valores bloqueados por reservas ainda vivas do usuário. */
export async function reservedCents(
  userId: string,
  tx: Prisma.TransactionClient = prisma
): Promise<number> {
  const agg = await tx.reservation.aggregate({
    where: { userId, status: { in: [...ACTIVE_HOLD_STATUSES] } },
    _sum: { amountCents: true },
  });
  return agg._sum.amountCents ?? 0;
}

/** Máquina está utilizável agora? (heartbeat recente + sem falha/manutenção) */
export function machineAvailability(m: Machine | null): "FREE" | "WASHING" | "DOWN" {
  if (!m) return "DOWN";
  if (m.status === "FAULT" || m.status === "MAINTENANCE") return "DOWN";
  const stale =
    !m.lastHeartbeat ||
    Date.now() - m.lastHeartbeat.getTime() > HEARTBEAT_OFFLINE_S * 1000;
  if (stale) return "DOWN";
  return m.status === "WASHING" ? "WASHING" : "FREE";
}

/** Fixa uma luz transitória na máquina (o ESP32 pega no próximo heartbeat). */
export async function setTransientLight(
  machineId: string,
  light: LightState,
  seconds: number = LIGHT_TRANSIENT_S,
  tx: Prisma.TransactionClient = prisma
) {
  await tx.machine.update({
    where: { id: machineId },
    data: { lightState: light, lightUntil: new Date(Date.now() + seconds * 1000) },
  });
}

/** Luz que o heartbeat deve devolver para esta máquina agora. */
export async function computeLight(m: Machine): Promise<LightState> {
  if (m.lightUntil && m.lightUntil.getTime() > Date.now())
    return m.lightState as LightState;
  if (m.status === "FAULT" || m.status === "MAINTENANCE") return "RED_BLINK";
  const active = await prisma.reservation.findFirst({
    where: { machineId: m.id, status: "ACTIVE" },
  });
  if (active) return "GREEN_SOLID";
  return "OFF";
}

/** Reserva que a máquina deve executar (START reenviado até car-entered/complete). */
export async function pendingStart(m: Machine): Promise<Reservation | null> {
  return prisma.reservation.findFirst({
    where: { machineId: m.id, status: { in: ["ACTIVE", "ENTERED"] } },
    orderBy: { activeAt: "asc" },
  });
}

/**
 * Expira o que venceu — chamado pelo cron e oportunisticamente pelos endpoints:
 *  - HELD vencida → EXPIRED (saldo volta a ficar disponível; sem estorno)
 *  - ACTIVE sem X14 em 5 min → volta a HELD (nova tentativa dentro da validade)
 *  - ENTERED além de 2x a duração do programa → FAILED (alerta p/ admin)
 *  - máquinas sem heartbeat 60s+ → OFFLINE
 */
export async function expireStale() {
  const now = new Date();

  const expired = await prisma.reservation.updateMany({
    where: { status: "HELD", expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });

  const stuckActive = await prisma.reservation.findMany({
    where: { status: "ACTIVE", activeAt: { lt: new Date(now.getTime() - ACTIVE_TTL_MIN * 60_000) } },
  });
  for (const r of stuckActive) {
    await prisma.reservation.update({
      where: { id: r.id },
      data:
        r.expiresAt > now
          ? { status: "HELD", machineId: null, activeAt: null } // nova tentativa
          : { status: "EXPIRED" },
    });
  }

  const entered = await prisma.reservation.findMany({
    where: { status: "ENTERED" },
    include: { program: true },
  });
  for (const r of entered) {
    const limitMs = (r.program.duracaoMin || 30) * 2 * 60_000;
    if (r.enteredAt && now.getTime() - r.enteredAt.getTime() > limitMs) {
      await prisma.reservation.update({ where: { id: r.id }, data: { status: "FAILED" } });
      await prisma.event.create({
        data: {
          type: "reservation_timeout",
          payload: { reservationId: r.id, userId: r.userId, machineId: r.machineId },
        },
      });
    }
  }

  const offline = await prisma.machine.updateMany({
    where: {
      status: { in: ["FREE", "WASHING"] },
      OR: [
        { lastHeartbeat: null },
        { lastHeartbeat: { lt: new Date(now.getTime() - HEARTBEAT_OFFLINE_S * 1000) } },
      ],
    },
    data: { status: "OFFLINE" },
  });

  return { expired: expired.count, requeued: stuckActive.length, offline: offline.count };
}

/** Estação/máquina padrão para o modo teste (sem cadastro prévio). */
export async function defaultMachine(): Promise<Machine> {
  const existing = await prisma.machine.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  const station = await prisma.washStation.create({
    data: { name: "Pili Lave", address: "", city: "" },
  });
  return prisma.machine.create({
    data: { stationId: station.id, name: "Máquina 1", deviceKey: `dev_${station.id.slice(-8)}` },
  });
}
