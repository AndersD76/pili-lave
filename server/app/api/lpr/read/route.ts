import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDevice } from "@/lib/device";
import { normalizePlate, plateCandidates } from "@/lib/placa";
import { handlePlateRead } from "@/lib/lpr";

const Body = z.object({ plate: z.string().min(6).max(10) });

/**
 * Câmera LPR: "chegou um carro com esta placa".
 * A decisão (reserva × estado da máquina → luz) vive em lib/lpr.ts —
 * compartilhada com /api/lpr/frame. Idempotente por placa dentro da janela.
 * Aceita leituras com sósias (TRC3JO8 → TRC3J08): vale se a leitura for
 * coercível a um formato válido, não só se já vier perfeita.
 */
export async function POST(req: NextRequest) {
  const denied = requireDevice(req);
  if (denied) return denied;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "plate obrigatória" }, { status: 400 });
  const plate = normalizePlate(parsed.data.plate);
  if (plateCandidates(plate).length === 0)
    return NextResponse.json({ error: "placa inválida", plate }, { status: 422 });

  const result = await handlePlateRead(plate);
  return NextResponse.json(result);
}
