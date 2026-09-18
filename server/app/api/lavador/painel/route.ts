import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { HEARTBEAT_OFFLINE_S, machineAvailability } from "@/lib/reservations";

/**
 * Painel do lavador: só as máquinas que ELE administra (Machine.operadorId).
 * Nada de outras unidades — cada um vê só a própria máquina, como pedido.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const maquinas = await prisma.machine.findMany({
    where: { operadorId: auth.user.id },
    include: { station: true },
    orderBy: [{ station: { city: "asc" } }, { numero: "asc" }],
  });

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const d7 = new Date(Date.now() - 7 * 86_400_000);
  const d30 = new Date(Date.now() - 30 * 86_400_000);

  const painel = await Promise.all(
    maquinas.map(async (m) => {
      const [hojeAgg, semanaAgg, mesAgg] = await Promise.all([
        prisma.reservation.aggregate({
          where: { machineId: m.id, status: "COMPLETED", completedAt: { gte: hoje } },
          _count: true, _sum: { amountCents: true },
        }),
        prisma.reservation.aggregate({
          where: { machineId: m.id, status: "COMPLETED", completedAt: { gte: d7 } },
          _count: true, _sum: { amountCents: true },
        }),
        prisma.reservation.aggregate({
          where: { machineId: m.id, status: "COMPLETED", completedAt: { gte: d30 } },
          _count: true, _sum: { amountCents: true },
        }),
      ]);
      const offline =
        !m.lastHeartbeat || Date.now() - m.lastHeartbeat.getTime() > HEARTBEAT_OFFLINE_S * 1000;

      return {
        id: m.id,
        numero: m.numero,
        unidade: { cidade: m.station.city, rua: m.station.address },
        status: offline ? "OFFLINE" : machineAvailability(m),
        emFalha: m.status === "FAULT",
        emManutencao: m.status === "MAINTENANCE",
        hoje: { lavagens: hojeAgg._count, faturamentoCents: hojeAgg._sum.amountCents ?? 0 },
        semana: { lavagens: semanaAgg._count, faturamentoCents: semanaAgg._sum.amountCents ?? 0 },
        mes: { lavagens: mesAgg._count, faturamentoCents: mesAgg._sum.amountCents ?? 0 },
      };
    })
  );

  return NextResponse.json({ maquinas: painel });
}
