import { NextRequest, NextResponse, after } from "next/server";
import { requireDevice } from "@/lib/device";
import { plateCandidates } from "@/lib/placa";
import { handlePlateRead } from "@/lib/lpr";
import { recognizePlate, lastPlateScore } from "@/lib/vision";
import { saveFrame, updateFrame, readFrame } from "@/lib/frames";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

/**
 * Câmera dedicada (ESP32-CAM): envia o FRAME JPEG cru e recebe 202 NA HORA
 * (a câmera não espera a análise e já manda a próxima foto). O reconhecimento
 * roda em segundo plano (`after`) e o resultado aparece em /capturas.
 *
 * Anti-erro: placa aceita sozinha só com confiança >= 0.97; senão precisa
 * aparecer em 2 fotos dentro de 30 s (votação).
 */
const VOTE_WINDOW_MS = 30_000;
let votes: { plate: string; score: number; at: number }[] = [];
let lastSize = 0;
let lastAt = 0;
let chain: Promise<void> = Promise.resolve(); // análises em fila (1 chamada/s no reconhecedor)

async function analisar(id: string, jpeg: Buffer): Promise<void> {
  const now = Date.now();
  const similar = lastSize > 0 && Math.abs(jpeg.length - lastSize) / lastSize < 0.01;
  const recent = now - lastAt < 60_000;
  lastSize = jpeg.length;
  lastAt = now;
  if (similar && recent) { await updateFrame(id, { note: "cena parada (não analisada)" }); return; }

  const plate = await recognizePlate(jpeg);
  if (!plate) { await updateFrame(id, { note: "nenhuma placa legível" }); return; }
  const score = lastPlateScore();
  if (plateCandidates(plate).length === 0) { await updateFrame(id, { plate, score, note: "formato inválido" }); return; }

  const t = Date.now();
  votes = votes.filter((v) => t - v.at < VOTE_WINDOW_MS);
  votes.push({ plate, score, at: t });
  const iguais = votes.filter((v) => v.plate === plate).length;
  if (!(score >= 0.97 || iguais >= 2)) {
    await updateFrame(id, { plate, score, note: `pendente (1 de 2 votos; ${Math.round(score * 100)}%)` });
    return;
  }
  votes = votes.filter((v) => v.plate !== plate);

  const result = await handlePlateRead(plate);
  await updateFrame(id, { plate, score, status: result.status, light: result.light, clientName: result.clientName, note: null });
  await prisma.event.create({
    data: { type: "lpr_photo", payload: { plate, score, bytes: jpeg.length, arrivalId: result.arrivalId } },
  });
}

export async function POST(req: NextRequest) {
  const denied = requireDevice(req);
  if (denied) return denied;

  const jpeg = Buffer.from(await req.arrayBuffer());
  if (jpeg.length < 1000)
    return NextResponse.json({ error: "frame vazio ou pequeno demais" }, { status: 400 });
  if (jpeg.length > 4 * 1024 * 1024)
    return NextResponse.json({ error: "frame grande demais (máx 4MB)" }, { status: 413 });

  const meta = await saveFrame(jpeg);

  // responde já; analisa depois, em fila
  after(async () => {
    chain = chain.then(() => analisar(meta.id, jpeg)).catch((e) => {
      console.error("análise falhou:", e);
      return updateFrame(meta.id, { note: "erro na análise" });
    });
    await chain;
  });

  return NextResponse.json({ queued: true, id: meta.id }, { status: 202 });
}

/** Imagem de uma captura (?id=...) ou a última recebida. */
export async function GET(req: NextRequest) {
  const denied = requireDevice(req);
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get("id");
  const buf = await readFrame(id);
  if (!buf) return NextResponse.json({ error: "nenhum frame recebido ainda" }, { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
}
