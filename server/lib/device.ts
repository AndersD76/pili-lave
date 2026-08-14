import { NextRequest, NextResponse } from "next/server";

/** Autentica dispositivos (câmera LPR e máquina) pelo header x-device-key. */
export function requireDevice(req: NextRequest): NextResponse | null {
  const key = req.headers.get("x-device-key");
  if (!process.env.DEVICE_KEY || key !== process.env.DEVICE_KEY)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

/** Janela em que uma chegada fica válida esperando o motorista. */
export const ARRIVAL_TTL_MIN = 10;
