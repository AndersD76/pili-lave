import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { HEARTBEAT_OFFLINE_S, machineAvailability } from "@/lib/reservations";
import { percentualDoUsuarioNaMaquina, relatorioMaquinaPara } from "@/lib/comissao";

/** Sem percentual configurado ainda pro lavador dessa máquina (nunca deveria
 * acontecer numa máquina já em operação) — cai nesse valor só pra não
 * quebrar a tela; o certo é o admin cadastrar o percentual de verdade. */
const FALLBACK_SEM_CONFIGURACAO = 55;

/**
 * Painel do lavador: só as máquinas que ELE administra (Machine.operadorId).
 *
 * Período: ?de=YYYY-MM-DD&ate=YYYY-MM-DD (datas escolhidas pelo lavador) ou
 * ?desde=acerto (tudo que ainda não foi "acertado" — desde o último
 * Machine.lastPaymentDate, o mesmo ponto de fechamento que o admin usa em
 * "Marcar pago hoje"). Sem nenhum dos dois, cai em hoje.
 *
 * Cada máquina traz a quebra por tipo de lavagem (1-4) x origem (presencial
 * = pago em dinheiro nos botões X1-X6 da máquina, app = pelo aplicativo) —
 * o valor mostrado em CADA coluna já é a PARTE DELE (não o total bruto):
 * no presencial é quanto ele fica pra si mesmo (o resto vai pros outros
 * participantes + admin), no app é quanto o admin tem que repassar pra
 * ele. Só "Total no período" continua bruto, sem divisão nenhuma. O
 * percentual em si e o corte dos outros nunca saem pro app do lavador.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const maquinas = await prisma.machine.findMany({
    where: { operadorId: auth.user.id },
    include: { station: true },
    orderBy: [{ station: { city: "asc" } }, { numero: "asc" }],
  });

  const de = req.nextUrl.searchParams.get("de");
  const ate = req.nextUrl.searchParams.get("ate");
  const desdeAcerto = req.nextUrl.searchParams.get("desde") === "acerto";

  const painel = await Promise.all(
    maquinas.map(async (m) => {
      const inicio = desdeAcerto
        ? (m.lastPaymentDate ?? new Date(0))
        : de
        ? new Date(`${de}T00:00:00`)
        : new Date(new Date().setHours(0, 0, 0, 0));
      const fim = ate ? new Date(`${ate}T23:59:59`) : new Date();

      const percentual = (await percentualDoUsuarioNaMaquina(m.id, auth.user.id)) || FALLBACK_SEM_CONFIGURACAO;
      const relatorio = await relatorioMaquinaPara(m.id, percentual, inicio, fim);

      const offline =
        !m.lastHeartbeat || Date.now() - m.lastHeartbeat.getTime() > HEARTBEAT_OFFLINE_S * 1000;

      return {
        id: m.id,
        numero: m.numero,
        unidade: { cidade: m.station.city, rua: m.station.address },
        status: offline ? "OFFLINE" : machineAvailability(m),
        emFalha: m.status === "FAULT",
        emManutencao: m.status === "MAINTENANCE",
        periodo: { inicio: inicio.toISOString(), fim: fim.toISOString() },
        ...relatorio,
      };
    })
  );

  return NextResponse.json({ maquinas: painel });
}
