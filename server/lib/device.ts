import { Machine } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";
import { defaultMachine } from "./reservations";

/** Autentica dispositivos (câmera LPR e máquina) pelo header x-device-key.
 *  FASE DE TESTE: sem DEVICE_KEY no ambiente, os endpoints ficam abertos. */
export function requireDevice(req: NextRequest): NextResponse | null {
  if (!process.env.DEVICE_KEY) return null;
  const key = req.headers.get("x-device-key");
  if (key !== process.env.DEVICE_KEY)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

/**
 * Resolve a MÁQUINA do request: cada ESP32 tem seu Machine.deviceKey próprio
 * (multi-máquina pronto). Compat: a chave global DEVICE_KEY (ou modo teste
 * sem chave) resolve para a máquina padrão, criada sob demanda.
 */
export async function requireMachine(
  req: NextRequest
): Promise<{ machine: Machine } | { error: NextResponse }> {
  const key = req.headers.get("x-device-key");
  if (key) {
    const machine = await prisma.machine.findUnique({ where: { deviceKey: key } });
    if (machine) return { machine };
  }
  if (!process.env.DEVICE_KEY || key === process.env.DEVICE_KEY)
    return { machine: await defaultMachine() };
  return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
}

/** Janela em que uma chegada fica válida esperando o motorista. */
export const ARRIVAL_TTL_MIN = 10;
