import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { HEARTBEAT_OFFLINE_S, machineAvailability } from "@/lib/reservations";
import { relatorioMaquinaPara } from "@/lib/comissao";

const NOME_TIPO: Record<string, string> = {
  COMISSAO1: "Comissão 1",
  COMISSAO2: "Comissão 2",
  ALUGUEL: "Aluguel",
  LAVADOR: "Lavador",
};

/**
 * Painel do parceiro (comissão 1/2, aluguel — ou lavador com percentual
 * configurado acessando por aqui também): igual ao painel do lavador,
 * MENOS o status de falha em destaque e SEM notificação nenhuma — o
 * parceiro só vê o relatório financeiro das máquinas em que tem % vinculado.
 *
 * Período: mesmos parâmetros de /api/lavador/painel (?de=&ate= ou
 * ?desde=acerto).
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const vinculos = await prisma.machineParticipante.findMany({
    where: { userId: auth.user.id },
    include: { machine: { include: { station: true } } },
    orderBy: [{ machine: { station: { city: "asc" } } }, { machine: { numero: "asc" } }],
  });

  const de = req.nextUrl.searchParams.get("de");
  const ate = req.nextUrl.searchParams.get("ate");
  const desdeAcerto = req.nextUrl.searchParams.get("desde") === "acerto";

  const painel = await Promise.all(
    vinculos.map(async (v) => {
      const m = v.machine;
      const inicio = desdeAcerto
        ? (m.lastPaymentDate ?? new Date(0))
        : de
        ? new Date(`${de}T00:00:00`)
        : new Date(new Date().setHours(0, 0, 0, 0));
      const fim = ate ? new Date(`${ate}T23:59:59`) : new Date();

      const relatorio = await relatorioMaquinaPara(m.id, v.percentual, inicio, fim);
      const offline =
        !m.lastHeartbeat || Date.now() - m.lastHeartbeat.getTime() > HEARTBEAT_OFFLINE_S * 1000;

      return {
        id: m.id,
        numero: m.numero,
        unidade: { cidade: m.station.city, rua: m.station.address },
        tipo: v.tipo,
        tipoLabel: NOME_TIPO[v.tipo] ?? v.tipo,
        status: offline ? "OFFLINE" : machineAvailability(m),
        periodo: { inicio: inicio.toISOString(), fim: fim.toISOString() },
        ...relatorio,
      };
    })
  );

  return NextResponse.json({ maquinas: painel });
}
