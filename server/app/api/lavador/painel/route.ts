import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { HEARTBEAT_OFFLINE_S, machineAvailability } from "@/lib/reservations";

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
 * o percentual do lavador em cima disso ainda não foi definido, então só
 * mostra quantidade e valor de cada coluna por enquanto.
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

      const [appPorPrograma, presencialPorPrograma] = await Promise.all([
        prisma.reservation.groupBy({
          by: ["programId"],
          where: { machineId: m.id, status: "COMPLETED", completedAt: { gte: inicio, lte: fim } },
          _sum: { amountCents: true },
          _count: { _all: true },
        }),
        prisma.lavagemPresencial.groupBy({
          by: ["programId"],
          where: { machineId: m.id, completedAt: { gte: inicio, lte: fim } },
          _sum: { amountCents: true },
          _count: { _all: true },
        }),
      ]);

      const appMap = new Map(appPorPrograma.map((g) => [g.programId, g]));
      const presMap = new Map(presencialPorPrograma.map((g) => [g.programId, g]));

      let totalGeralCents = 0;
      const porTipo = [1, 2, 3, 4].map((programId) => {
        const app = appMap.get(programId);
        const pres = presMap.get(programId);
        const appCents = app?._sum.amountCents ?? 0;
        const presCents = pres?._sum.amountCents ?? 0;
        totalGeralCents += appCents + presCents;
        return {
          programId,
          app: { lavagens: app?._count._all ?? 0, valorCents: appCents },
          presencial: { lavagens: pres?._count._all ?? 0, valorCents: presCents },
        };
      });

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
        totalGeralCents,
        porTipo,
      };
    })
  );

  return NextResponse.json({ maquinas: painel });
}
