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

  // Lavagem e aspirador têm percentuais independentes agora — busca os dois
  // escopos e junta numa linha por máquina (uma pessoa pode ter vínculo só
  // num dos dois, ex: comissão só no aspirador, sem participar da lavagem).
  const todosVinculos = await prisma.machineParticipante.findMany({
    where: { userId: auth.user.id },
    include: { machine: { include: { station: true } } },
    orderBy: [{ machine: { station: { city: "asc" } } }, { machine: { numero: "asc" } }],
  });
  const porMaquina = new Map<string, typeof todosVinculos[number][]>();
  for (const v of todosVinculos) {
    const arr = porMaquina.get(v.machineId) ?? [];
    arr.push(v);
    porMaquina.set(v.machineId, arr);
  }
  const vinculos = Array.from(porMaquina.values()).map((rows) => {
    const lavagem = rows.find((r) => r.escopo === "LAVAGEM");
    const aspirador = rows.find((r) => r.escopo === "ASPIRADOR");
    const base = lavagem ?? rows[0];
    return { ...base, percentualLavagem: lavagem?.percentual ?? 0, percentualAspirador: aspirador?.percentual ?? 0 };
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

      const relatorio = await relatorioMaquinaPara(m.id, v.percentualLavagem, inicio, fim, v.percentualAspirador);
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
