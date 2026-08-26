import { NextRequest, NextResponse } from "next/server";
import { requireDevice } from "@/lib/device";
import { plateCandidates } from "@/lib/placa";
import { handlePlateRead } from "@/lib/lpr";
import { recognizePlate, lastPlateScore } from "@/lib/vision";
import { saveFrame, updateFrame, readFrame } from "@/lib/frames";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60; // varredura + recorte podem levar alguns segundos

/**
 * Câmera dedicada (ESP32-CAM / futura câmera IP): envia o FRAME JPEG cru;
 * o reconhecimento roda aqui na nuvem (lib/vision). Toda captura fica
 * visível em /capturas com o resultado.
 *
 * Anti-erro de leitura: placa aceita se confiança >= 0.9 OU se a MESMA
 * placa aparecer em 2 frames dentro de 20 s (a câmera manda 2 por chegada).
 */
let lastSize = 0;
let lastAt = 0;
// votação: leituras dos últimos 30 s (a câmera manda várias fotos por chegada)
const VOTE_WINDOW_MS = 30_000;
let votes: { plate: string; score: number; at: number }[] = [];

export async function POST(req: NextRequest) {
  const denied = requireDevice(req);
  if (denied) return denied;

  const jpeg = Buffer.from(await req.arrayBuffer());
  if (jpeg.length < 1000)
    return NextResponse.json({ error: "frame vazio ou pequeno demais" }, { status: 400 });
  if (jpeg.length > 4 * 1024 * 1024)
    return NextResponse.json({ error: "frame grande demais (máx 4MB)" }, { status: 413 });

  const meta = await saveFrame(jpeg);

  const now = Date.now();
  const similar = lastSize > 0 && Math.abs(jpeg.length - lastSize) / lastSize < 0.015;
  const recent = now - lastAt < 60_000;
  lastSize = jpeg.length;
  lastAt = now;
  if (similar && recent) {
    updateFrame(meta.id, { note: "cena parada (não analisada)" });
    return NextResponse.json({ plate: null, light: null, skipped: "cena parada" });
  }

  const plate = await recognizePlate(jpeg);
  if (!plate) {
    updateFrame(meta.id, { note: "nenhuma placa legível" });
    return NextResponse.json({ plate: null, light: null });
  }
  const score = lastPlateScore();

  if (plateCandidates(plate).length === 0) {
    updateFrame(meta.id, { plate, score, note: "formato inválido" });
    return NextResponse.json({ plate, light: null });
  }

  votes = votes.filter((v) => now - v.at < VOTE_WINDOW_MS);
  votes.push({ plate, score, at: now });
  const iguais = votes.filter((v) => v.plate === plate).length;
  const confirmed = score >= 0.9 || iguais >= 2;
  if (!confirmed) {
    updateFrame(meta.id, { plate, score, note: `pendente (1 de 2 votos; ${Math.round(score * 100)}%)` });
    return NextResponse.json({ plate, light: null, pending: true, score, votos: iguais });
  }
  votes = votes.filter((v) => v.plate !== plate); // consumiu os votos desta placa

  const result = await handlePlateRead(plate);
  updateFrame(meta.id, {
    plate, score, status: result.status, light: result.light, clientName: result.clientName,
  });
  await prisma.event.create({
    data: { type: "lpr_photo", payload: { plate, score, bytes: jpeg.length, arrivalId: result.arrivalId } },
  });
  return NextResponse.json({ plate, score, ...result });
}

/** Imagem de uma captura (?id=...) ou a última recebida. */
export async function GET(req: NextRequest) {
  const denied = requireDevice(req);
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get("id");
  const buf = await readFrame(id);
  if (!buf) return NextResponse.json({ error: "nenhum frame recebido ainda" }, { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
  });
}
