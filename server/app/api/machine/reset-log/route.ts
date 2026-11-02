import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMachine } from "@/lib/device";
import { avisarAdmins, avisarCliente } from "@/lib/push";
import { causaDoReset, interpretarReset } from "@/lib/resets";

const Body = z.object({
  key: z.string().min(1).max(40), // chave única do reinício na placa ("W1-12"): torna o reenvio idempotente
  info: z.string().max(80), // "W1;m=6;e=5;u=1234;n=12;c=1;s=0" (ver lib/resets.ts)
});

/**
 * Histórico de reinícios das placas (W1/W2), enviado pela câmera a cada reconexão.
 *
 * - Cada reinício vira um Event "machine_reset" (sem tabela nova). Idempotente pela `key`: a câmera/display reenviam
 *   até receber 200, então o mesmo reinício pode chegar mais de uma vez.
 * - Reinício com a máquina parada ou que voltou ao normal: só registro (o admin vê em Máquinas).
 * - Reinício NO MEIO de um ciclo (carro presente) é uma parada da máquina: o lavador da máquina e os admins recebem o
 *   aviso na hora, no celular.
 * - Resposta 200 mesmo para conteúdo ilegível: o display só tira o evento da fila quando recebe o 200 (via câmera).
 *   Um 4xx aqui travaria a fila de eventos de lavagem atrás deste. Só a falta de autenticação devolve erro.
 */
export async function POST(req: NextRequest) {
  const auth = await requireMachine(req);
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, ignorado: "corpo inválido" });
  const { key, info } = parsed.data;

  const r = interpretarReset(info);
  if (!r) return NextResponse.json({ ok: false, ignorado: "info não reconhecida" });

  const chave = `${auth.machine.id}:${key}`;
  const ja = await prisma.event.findFirst({
    where: { type: "machine_reset", payload: { path: ["chave"], equals: chave } },
    select: { id: true },
  });
  if (ja) return NextResponse.json({ ok: true, duplicado: true });

  await prisma.event.create({
    data: {
      type: "machine_reset",
      payload: {
        chave,
        machineId: auth.machine.id,
        quem: r.quem,
        motivo: r.motivo,
        motivoNome: r.motivoNome,
        estado: r.estado,
        estadoNome: r.estadoNome,
        emCiclo: r.emCiclo,
        upAntSeg: r.upAntSeg,
        total: r.total,
        deliberado: r.deliberado,
      },
    },
  });

  // Reset técnico (botão EN / USB / JTAG) nunca avisa ninguém, mesmo que a W1 estivesse em ciclo.
  const tecnico = r.motivo === 2 || r.motivo === 11 || r.motivo === 12;
  if (r.emCiclo && !tecnico) {
    const aviso = {
      titulo: r.quem === "W1" ? "A máquina parou: placa reiniciou" : "A máquina pausou: placa reiniciou",
      // W1 perdeu o ciclo (fica esperando o HOME no display). W2: a W1 pausa e retoma sozinha quando ela volta.
      corpo:
        r.quem === "W1"
          ? `A placa W1 reiniciou no meio de uma lavagem (${causaDoReset(r)}). O ciclo foi perdido: confira a máquina e faça o HOME no display.`
          : `A placa W2 reiniciou durante uma lavagem (${causaDoReset(r)}). A máquina pausa e retoma sozinha: confira se voltou a lavar.`,
      url: "/admin",
      tag: `reset-${chave}`,
    };
    void avisarAdmins(aviso);
    if (auth.machine.operadorId) void avisarCliente(auth.machine.operadorId, { ...aviso, url: "/app" });
  }

  return NextResponse.json({ ok: true });
}
