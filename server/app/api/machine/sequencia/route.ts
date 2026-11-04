import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMachine } from "@/lib/device";
import { PROC_NOME } from "@/lib/etapas";

const Body = z.object({
  modelo: z.number().int().min(1).max(4),                 // modelo da máquina = programId (1..4)
  seq: z.string().min(1).max(60).regex(/^\d+(\.\d+)*$/),   // ids dos processos na ordem, separados por ponto: "3.5.7.3.5.7.6.1.8"
});

/**
 * Sequência de processos de um modelo, enviada pelo display quando ela é alterada na tela de Configuração (e uma vez ao ligar): a câmera faz
 * este POST até receber 200. Vira um Event "sequencia_modelo" (sem tabela nova) e passa a valer na lista de tarefas que o app mostra durante a
 * lavagem (lib/etapas.ts) — a lista do app é sempre a que a máquina realmente executa. Só aceita ids de processo conhecidos; resposta 200 mesmo
 * para corpo inválido (a câmera só tira o evento da fila com 2xx; um 4xx o repetiria para sempre). Só a falta de autenticação devolve erro.
 */
export async function POST(req: NextRequest) {
  const auth = await requireMachine(req);
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, ignorado: "corpo inválido" });
  const seq = parsed.data.seq.split(".").map(Number);
  if (seq.length > 14 || seq.some((p) => !(p in PROC_NOME))) return NextResponse.json({ ok: false, ignorado: "processo desconhecido" });

  // não grava de novo se for igual à última (ao ligar o display reenvia as 4)
  const ultima = await prisma.event.findFirst({
    where: { type: "sequencia_modelo", AND: [{ payload: { path: ["machineId"], equals: auth.machine.id } }, { payload: { path: ["modelo"], equals: parsed.data.modelo } }] },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  const igual = JSON.stringify((ultima?.payload as { seq?: number[] } | null)?.seq ?? null) === JSON.stringify(seq);
  if (!igual)
    await prisma.event.create({
      data: { type: "sequencia_modelo", payload: { machineId: auth.machine.id, modelo: parsed.data.modelo, seq } },
    });
  return NextResponse.json({ ok: true, igual });
}
