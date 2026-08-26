/**
 * Últimas capturas da câmera (anel em disco, /tmp) para a página /capturas.
 * Reinicia a cada deploy — é diagnóstico, não histórico.
 */
import { mkdir, readFile, writeFile, unlink } from "fs/promises";
import path from "path";

const DIR = "/tmp/pili_frames";
const MAX = 24;

export type FrameMeta = {
  id: string;
  at: string;          // ISO
  bytes: number;
  plate: string | null;
  score: number | null;
  status: string | null;   // resultado da chegada (WAITING_DRIVER, NO_MATCH…)
  light: string | null;
  note: string | null;     // "cena parada", "pendente", "rejeitada"…
  clientName: string | null;
};

const ring: FrameMeta[] = [];

export async function saveFrame(jpeg: Buffer): Promise<FrameMeta> {
  await mkdir(DIR, { recursive: true }).catch(() => {});
  const id = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await writeFile(path.join(DIR, `${id}.jpg`), jpeg);
  const meta: FrameMeta = {
    id, at: new Date().toISOString(), bytes: jpeg.length,
    plate: null, score: null, status: null, light: null, note: null, clientName: null,
  };
  ring.unshift(meta);
  while (ring.length > MAX) {
    const old = ring.pop();
    if (old) unlink(path.join(DIR, `${old.id}.jpg`)).catch(() => {});
  }
  return meta;
}

export function updateFrame(id: string, patch: Partial<FrameMeta>): void {
  const m = ring.find((f) => f.id === id);
  if (m) Object.assign(m, patch);
}

export function listFrames(): FrameMeta[] {
  return ring;
}

export async function readFrame(id?: string | null): Promise<Buffer | null> {
  const meta = id ? ring.find((f) => f.id === id) : ring[0];
  if (!meta) return null;
  return readFile(path.join(DIR, `${meta.id}.jpg`)).catch(() => null);
}
