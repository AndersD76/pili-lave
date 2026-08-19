import { NextRequest, NextResponse } from "next/server";
import { requireDevice } from "@/lib/device";
import { plateCandidates } from "@/lib/placa";
import { handlePlateRead } from "@/lib/lpr";
import { recognizePlate } from "@/lib/vision";
import { prisma } from "@/lib/prisma";

export const maxDuration = 30; // OCR pode levar alguns segundos

/**
 * Câmera dedicada (ESP32-CAM / futura câmera IP): envia o FRAME JPEG cru;
 * o reconhecimento roda aqui na nuvem. Trocar o dispositivo de captura
 * nunca muda o backend — só quem chama este endpoint.
 *
 * Reconhecimento (lib/vision): Plate Recognizer com PLATE_RECOGNIZER_TOKEN;
 * sem token, fallback grátis com tesseract (pré-processado com sharp).
 */

// Cena parada gera JPEGs de tamanho quase idêntico: pula o reconhecimento
// (economiza OCR/quota; leituras repetidas já são deduplicadas adiante).
let lastSize = 0;
let lastAt = 0;

export async function POST(req: NextRequest) {
  const denied = requireDevice(req);
  if (denied) return denied;

  const jpeg = Buffer.from(await req.arrayBuffer());
  if (jpeg.length < 1000)
    return NextResponse.json({ error: "frame vazio ou pequeno demais" }, { status: 400 });
  if (jpeg.length > 4 * 1024 * 1024)
    return NextResponse.json({ error: "frame grande demais (máx 4MB)" }, { status: 413 });

  const now = Date.now();
  const similar = lastSize > 0 && Math.abs(jpeg.length - lastSize) / lastSize < 0.015;
  const recent = now - lastAt < 60_000;
  lastSize = jpeg.length;
  lastAt = now;
  if (similar && recent) return NextResponse.json({ plate: null, light: null, skipped: "cena parada" });

  const plate = await recognizePlate(jpeg);
  if (!plate) return NextResponse.json({ plate: null, light: null }); // pátio vazio/sem placa legível

  if (plateCandidates(plate).length === 0)
    return NextResponse.json({ plate, light: null });

  const result = await handlePlateRead(plate);
  await prisma.event.create({
    data: { type: "lpr_photo", payload: { plate, bytes: jpeg.length, arrivalId: result.arrivalId } },
  });
  return NextResponse.json({ plate, ...result });
}
