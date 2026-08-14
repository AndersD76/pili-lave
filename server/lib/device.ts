import { NextRequest, NextResponse } from "next/server";

/** Autentica dispositivos (câmera LPR e máquina) pelo header x-device-key.
 *  FASE DE TESTE: sem DEVICE_KEY no ambiente, os endpoints ficam abertos. */
export function requireDevice(req: NextRequest): NextResponse | null {
  if (!process.env.DEVICE_KEY) return null;
  const key = req.headers.get("x-device-key");
  if (key !== process.env.DEVICE_KEY)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

/** Janela em que uma chegada fica válida esperando o motorista. */
export const ARRIVAL_TTL_MIN = 10;
