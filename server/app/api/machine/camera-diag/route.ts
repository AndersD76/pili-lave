import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMachine } from "@/lib/device";

const n = z.number().int().min(-2_000_000_000).max(4_000_000_000);

const Body = z.object({
  fw: n, up: n, rst: n, janelaS: n, ch: n,
  rssi: n, rssiMin: n, rssiMax: n, rssiMed: n,
  heap: n, heapMin: n, bloco: n, blocoMin: n,
  fOk: n, fFalha: n, fSeg: n, fCode: n,
  hbOk: n, hbFalha: n, hbCode: n,
  quedas: n, scans: n, descMaxS: n, fbFalhas: n,
});

/**
 * Diagnóstico da câmera (firmware v8+): a cada ~5 min, e quando várias fotos seguidas falham, ela manda um resumo do que aconteceu na
 * janela (Wi-Fi: sinal mín/méd/máx, quedas e maior tempo desconectada, buscas de rede; memória: heap e maior bloco livre; fotos e
 * heartbeats ok/falha e último código de erro; motivo do último reinício e tempo ligada). Cada resumo vira um Event "camera_diag"
 * (sem tabela nova) — só para ANALISAR por que a câmera fica sem enviar fotos; não decide nada nem avisa ninguém.
 * Resposta 200 mesmo para corpo ilegível (a câmera só zera os contadores quando recebe 2xx; um 4xx a faria acumular para sempre).
 * Só a falta de autenticação devolve erro.
 */
export async function POST(req: NextRequest) {
  const auth = await requireMachine(req);
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, ignorado: "corpo inválido" });

  await prisma.event.create({
    data: { type: "camera_diag", payload: { ...parsed.data, machineId: auth.machine.id } },
  });
  return NextResponse.json({ ok: true });
}
