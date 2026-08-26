/**
 * Capturas da câmera (foto + resultado) guardadas no banco — o histórico
 * sobrevive a deploys e aparece inteiro em /capturas.
 */
import { prisma } from "./prisma";

const KEEP = 300; // mantém as últimas N capturas

export type FrameMeta = {
  id: string;
  at: string;
  bytes: number;
  plate: string | null;
  score: number | null;
  status: string | null;
  light: string | null;
  note: string | null;
  clientName: string | null;
};

export async function saveFrame(jpeg: Buffer): Promise<FrameMeta> {
  const c = await prisma.capture.create({
    data: { bytes: jpeg.length, jpeg: new Uint8Array(jpeg), note: "analisando…" },
    select: { id: true, at: true, bytes: true },
  });
  // poda assíncrona
  (async () => {
    const old = await prisma.capture.findMany({ orderBy: { at: "desc" }, skip: KEEP, select: { id: true }, take: 50 });
    if (old.length) await prisma.capture.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  })().catch(() => {});
  return { id: c.id, at: c.at.toISOString(), bytes: c.bytes, plate: null, score: null, status: null, light: null, note: "analisando…", clientName: null };
}

export async function updateFrame(id: string, patch: Partial<Omit<FrameMeta, "id" | "at" | "bytes">>): Promise<void> {
  await prisma.capture.update({ where: { id }, data: patch }).catch(() => {});
}

export async function listFrames(limit = 120): Promise<FrameMeta[]> {
  const rows = await prisma.capture.findMany({
    orderBy: { at: "desc" },
    take: limit,
    select: { id: true, at: true, bytes: true, plate: true, score: true, status: true, light: true, note: true, clientName: true },
  });
  return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
}

export async function readFrame(id?: string | null): Promise<Buffer | null> {
  const row = id
    ? await prisma.capture.findUnique({ where: { id }, select: { jpeg: true } })
    : await prisma.capture.findFirst({ orderBy: { at: "desc" }, select: { jpeg: true } });
  return row ? Buffer.from(row.jpeg) : null;
}
