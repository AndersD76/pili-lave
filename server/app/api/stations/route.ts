import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HEARTBEAT_OFFLINE_S } from "@/lib/reservations";

/**
 * Lista pública de unidades p/ a tela "Unidades" do app:
 * endereço + coordenadas (mapa/distância) + situação agregada das máquinas.
 * situacao: ABERTO (alguma livre) | OCUPADO (todas lavando) |
 *           MANUTENCAO (falha/manutenção/offline) | INATIVO (desativada)
 */
export async function GET() {
  const stations = await prisma.washStation.findMany({
    include: { machines: true },
    orderBy: { createdAt: "asc" },
  });

  const now = Date.now();
  const list = stations.map((st) => {
    const machines = st.machines.map((m) => {
      const stale =
        !m.lastHeartbeat || now - m.lastHeartbeat.getTime() > HEARTBEAT_OFFLINE_S * 1000;
      const status = stale && (m.status === "FREE" || m.status === "WASHING") ? "OFFLINE" : m.status;
      return { id: m.id, name: m.name, status, remainingSec: m.remainingSec };
    });

    let situacao: "ABERTO" | "OCUPADO" | "MANUTENCAO" | "INATIVO";
    if (!st.active) situacao = "INATIVO";
    else if (machines.some((m) => m.status === "FREE")) situacao = "ABERTO";
    else if (machines.some((m) => m.status === "WASHING")) situacao = "OCUPADO";
    else situacao = "MANUTENCAO";

    return {
      id: st.id,
      name: st.name,
      address: st.address,
      city: st.city,
      state: st.state,
      lat: st.lat,
      lng: st.lng,
      situacao,
      machines,
    };
  });

  return NextResponse.json({ stations: list });
}
