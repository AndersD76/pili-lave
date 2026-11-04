import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMachine } from "@/lib/device";
import { avisarAdmins, avisarCliente } from "@/lib/push";
import { interpretarContadores, registrarContadores } from "@/lib/contadores";
import { causaDoReset, horaPlausivel, interpretarEtapa, interpretarOcorrencia, interpretarReset } from "@/lib/resets";

const Body = z.object({
  key: z.string().min(1).max(40), // chave única do reinício na placa ("W1-12"): torna o reenvio idempotente
  info: z.string().max(80), // "W1;m=6;e=5;u=1234;n=12;c=1;s=0;t=1798800000" (ver lib/resets.ts)
});

/**
 * Histórico de reinícios das placas (W1/W2), enviado pela câmera a cada reconexão.
 *
 * - Cada reinício vira um Event "machine_reset" (sem tabela nova). Idempotente pela `key`: a câmera/display reenviam
 *   até receber 200, então o mesmo reinício pode chegar mais de uma vez.
 * - Reinício com a máquina parada ou que voltou ao normal: só registro (o admin vê em Máquinas).
 * - Reinício NO MEIO de um ciclo (carro presente) é uma parada da máquina: o lavador da máquina e os admins recebem o
 *   aviso na hora, no celular.
 * - Regra do Giovani (2026-11-02): se a W1 reiniciou e a lavagem do app NÃO foi concluída, ela é CANCELADA e o valor
 *   ESTORNADO ao cliente na hora (sem esperar o cron). Não reagenda: o cliente reserva de novo pelo app se quiser.
 *   Só age com a HORA do reset conhecida (`t`, vinda do relógio da máquina) e em reserva que COMEÇOU ANTES do reset:
 *   um reinício antigo reenviado depois de horas nunca cancela a lavagem de outro cliente. Sem hora: só registra e avisa.
 *   A W2 reiniciar NÃO cancela nada (a W1 pausa e retoma sozinha).
 * - Resposta 200 mesmo para conteúdo ilegível: o display só tira o evento da fila quando recebe o 200 (via câmera).
 *   Um 4xx aqui travaria a fila de eventos de lavagem atrás deste. Só a falta de autenticação devolve erro.
 */
export async function POST(req: NextRequest) {
  const auth = await requireMachine(req);
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, ignorado: "corpo inválido" });
  const { key, info } = parsed.data;

  // Contadores de lavagem do display ("C;1;d=2.11.2026;p=5.22.4.4;a=6.6.1.0"): o display é a referência; a nuvem confere e avisa o admin se diferir (lib/contadores.ts).
  if (info.startsWith("C;")) {
    const rel = interpretarContadores(info);
    if (!rel) return NextResponse.json({ ok: false, ignorado: "contadores não reconhecidos" });
    await registrarContadores(auth.machine, rel).catch((e) => console.error("contadores falhou:", e));
    return NextResponse.json({ ok: true });
  }

  // Fase 0 da retomada: retrato da etapa ("J;...") e ocorrências observadas ("O;..."): só registro, não cancela nem avisa.
  if (info.startsWith("J;") || info.startsWith("O;")) return registrarFase0(auth.machine.id, key, info);

  const r = interpretarReset(info);
  if (!r) return NextResponse.json({ ok: false, ignorado: "info não reconhecida" });

  const chave = `${auth.machine.id}:${key}`;
  const ja = await prisma.event.findFirst({
    where: { type: "machine_reset", payload: { path: ["chave"], equals: chave } },
    select: { id: true },
  });
  if (ja) return NextResponse.json({ ok: true, duplicado: true });

  // Hora do reset segundo o relógio da máquina (NTP via câmera). Só vale se for plausível: não no futuro (+5 min de folga)
  // e não mais velha que 7 dias; fora disso trata como "sem hora".
  const agoraMs = Date.now();
  let quandoReset: Date | null = null;
  if (r.quandoEpoch !== null) {
    const ms = r.quandoEpoch * 1000;
    if (ms <= agoraMs + 5 * 60_000 && agoraMs - ms <= 7 * 86_400_000) quandoReset = new Date(ms);
  }

  await prisma.event.create({
    data: {
      type: "machine_reset",
      payload: {
        chave,
        machineId: auth.machine.id,
        cicloNvs: r.cicloNvs,
        quem: r.quem,
        motivo: r.motivo,
        motivoNome: r.motivoNome,
        estado: r.estado,
        estadoNome: r.estadoNome,
        emCiclo: r.emCiclo,
        upAntSeg: r.upAntSeg,
        total: r.total,
        deliberado: r.deliberado,
        quandoReset: quandoReset ? quandoReset.toISOString() : null,
      },
    },
  });

  // Reset técnico (botão EN / USB / JTAG) nunca avisa nem cancela nada, mesmo que a W1 estivesse em ciclo.
  const tecnico = r.motivo === 2 || r.motivo === 11 || r.motivo === 12;
  if (!r.emCiclo || tecnico) return NextResponse.json({ ok: true });

  // --- W1 perdeu o ciclo: cancela e estorna as reservas do app que já tinham começado ANTES do reset ---
  let canceladas = 0;
  let estornoCents = 0;
  if (r.quem === "W1" && quandoReset) {
    const alvos = await prisma.reservation.findMany({
      where: { machineId: auth.machine.id, status: { in: ["ACTIVE", "ENTERED"] } },
      include: { order: true },
    });
    for (const rv of alvos) {
      const inicio = rv.enteredAt ?? rv.activeAt;
      if (!inicio || inicio.getTime() >= quandoReset.getTime()) continue; // começou depois do reset: é outra lavagem
      let estornou = false;
      await prisma.$transaction(async (tx) => {
        const upd = await tx.reservation.updateMany({
          where: { id: rv.id, status: { in: ["ACTIVE", "ENTERED"] } }, // trava contra corrida
          data: { status: "FAILED" },
        });
        if (upd.count === 0) return;
        canceladas++;
        if (rv.order && rv.order.status === "PAID") {
          await tx.order.update({ where: { id: rv.order.id }, data: { status: "CANCELED" } });
          await tx.user.update({ where: { id: rv.userId }, data: { walletCents: { increment: rv.amountCents } } });
          await tx.walletTx.create({
            data: {
              userId: rv.userId,
              amountCents: rv.amountCents,
              kind: "ADJUST",
              refId: rv.order.id,
              note: "estorno automático: a placa da máquina reiniciou durante a lavagem",
            },
          });
          estornou = true;
          estornoCents += rv.amountCents;
        }
      });
      void avisarCliente(rv.userId, {
        titulo: "Lavagem interrompida",
        corpo: estornou
          ? "A máquina teve um problema e a lavagem foi cancelada. O valor foi devolvido ao seu saldo. Se quiser, é só reservar de novo pelo app."
          : "A máquina teve um problema e a lavagem foi cancelada. Se quiser, é só reservar de novo pelo app.",
        tag: "lavagem",
      });
    }
    if (canceladas > 0) {
      await prisma.event.create({
        data: {
          type: "reservation_reset_cancel",
          payload: { chave, machineId: auth.machine.id, canceladas, estornoCents, quandoReset: quandoReset.toISOString() },
        },
      });
    }
  }

  const aviso = {
    titulo: r.quem === "W1" ? "A máquina parou: placa reiniciou" : "A máquina pausou: placa reiniciou",
    // W1 perdeu o ciclo (fica esperando o HOME no display). W2: a W1 pausa e retoma sozinha quando ela volta.
    corpo:
      r.quem === "W1"
        ? `A placa W1 reiniciou no meio de uma lavagem (${causaDoReset(r)}). O ciclo foi perdido${canceladas > 0 ? " e a lavagem do cliente foi cancelada e estornada" : ""}: confira a máquina e faça o HOME no display.`
        : `A placa W2 reiniciou durante uma lavagem (${causaDoReset(r)}). A máquina pausa e retoma sozinha: confira se voltou a lavar.`,
    url: "/admin",
    tag: `reset-${chave}`,
  };
  void avisarAdmins(aviso);
  if (auth.machine.operadorId) void avisarCliente(auth.machine.operadorId, { ...aviso, url: "/app" });

  return NextResponse.json({ ok: true, canceladas, estornoCents });
}

/**
 * Retrato da etapa (J) ou ocorrência observada (O). A chave do retrato é "J<quem>-<seq>": o evento principal correspondente tem a mesma
 * chave com "W" no lugar do "J" (`chaveReset`), para o painel juntar os dois. Idempotente. Responde 200 também para conteúdo ilegível.
 */
async function registrarFase0(machineId: string, key: string, info: string) {
  const chave = `${machineId}:${key}`;
  const ja = await prisma.event.findFirst({
    where: { type: { in: ["machine_etapa", "machine_ocorrencia"] }, payload: { path: ["chave"], equals: chave } },
    select: { id: true },
  });
  if (ja) return NextResponse.json({ ok: true, duplicado: true });

  if (info.startsWith("J;")) {
    const e = interpretarEtapa(info);
    if (!e) return NextResponse.json({ ok: false, ignorado: "etapa não reconhecida" });
    await prisma.event.create({
      data: { type: "machine_etapa", payload: { chave, chaveReset: `${machineId}:W${key.slice(1)}`, machineId, ...e } as object },
    });
    return NextResponse.json({ ok: true });
  }
  const o = interpretarOcorrencia(info);
  if (!o) return NextResponse.json({ ok: false, ignorado: "ocorrência não reconhecida" });
  const quando = horaPlausivel(o.quandoEpoch);
  await prisma.event.create({
    data: {
      type: "machine_ocorrencia",
      payload: { chave, machineId, ...o, quandoOcorrencia: quando ? quando.toISOString() : null } as object,
    },
  });
  return NextResponse.json({ ok: true });
}
