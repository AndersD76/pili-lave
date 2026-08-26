import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile } from "fs/promises";
import { requireDevice } from "@/lib/device";
import { plateCandidates } from "@/lib/placa";
import { handlePlateRead } from "@/lib/lpr";
import { recognizePlate, lastPlateScore } from "@/lib/vision";
import { prisma } from "@/lib/prisma";

export const maxDuration = 30; // OCR pode levar alguns segundos

const LAST_FRAME = "/tmp/pili_last_frame.jpg";

/**
 * Câmera dedicada (ESP32-CAM / futura câmera IP): envia o FRAME JPEG cru;
 * o reconhecimento roda aqui na nuvem. Trocar o dispositivo de captura
 * nunca muda o backend — só quem chama este endpoint.
 *
 * Reconhecimento (lib/vision): Plate Recognizer (com filtro de confiança);
 * sem token, fallback grátis com tesseract.
 *
 * Anti-erro de leitura: uma placa só é aceita se a confiança for muito alta
 * (>= 0.9) OU se a MESMA placa for lida em 2 frames dentro de 20 s
 * (a câmera manda 2 frames por chegada justamente para isso).
 */

// Cena parada gera JPEGs de tamanho quase idêntico: pula o reconhecimento
let lastSize = 0;
let lastAt = 0;
// confirmação por dupla leitura
let pending: { plate: string; at: number } | null = null;

export async function POST(req: NextRequest) {
  const denied = requireDevice(req);
  if (denied) return denied;

  const jpeg = Buffer.from(await req.arrayBuffer());
  if (jpeg.length < 1000)
    return NextResponse.json({ error: "frame vazio ou pequeno demais" }, { status: 400 });
  if (jpeg.length > 4 * 1024 * 1024)
    return NextResponse.json({ error: "frame grande demais (máx 4MB)" }, { status: 413 });

  // guarda o último frame p/ diagnóstico (GET neste mesmo endpoint)
  writeFile(LAST_FRAME, jpeg).catch(() => {});

  const now = Date.now();
  const similar = lastSize > 0 && Math.abs(jpeg.length - lastSize) / lastSize < 0.015;
  const recent = now - lastAt < 60_000;
  lastSize = jpeg.length;
  lastAt = now;
  if (similar && recent) return NextResponse.json({ plate: null, light: null, skipped: "cena parada" });

  const plate = await recognizePlate(jpeg);
  if (!plate) return NextResponse.json({ plate: null, light: null }); // sem placa legível

  if (plateCandidates(plate).length === 0)
    return NextResponse.json({ plate, light: null });

  const score = lastPlateScore();
  const confirmed =
    score >= 0.9 || (pending !== null && pending.plate === plate && now - pending.at < 20_000);
  if (!confirmed) {
    pending = { plate, at: now };
    return NextResponse.json({ plate, light: null, pending: true, score });
  }
  pending = null;

  const result = await handlePlateRead(plate);
  await prisma.event.create({
    data: { type: "lpr_photo", payload: { plate, score, bytes: jpeg.length, arrivalId: result.arrivalId } },
  });
  return NextResponse.json({ plate, score, ...result });
}

/** Diagnóstico: devolve o último frame recebido da câmera (imagem JPEG). */
export async function GET(req: NextRequest) {
  const denied = requireDevice(req);
  if (denied) return denied;
  try {
    const buf = await readFile(LAST_FRAME);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "nenhum frame recebido ainda" }, { status: 404 });
  }
}
