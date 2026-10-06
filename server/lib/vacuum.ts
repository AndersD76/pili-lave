import { prisma } from "@/lib/prisma";

/**
 * Fecha usos de aspirador vencidos (ACTIVE cujo tempo já esgotou) mas que
 * ainda não foram marcados COMPLETED. O caminho normal é o heartbeat do
 * display fazer essa transição a cada ciclo — mas o app local (sem display
 * conectado, ex. em testes) não dispara heartbeat nenhum, e o uso ficava
 * preso em ACTIVE pra sempre, sumindo do faturamento. Chamado também pelos
 * relatórios (painel do lavador/parceiro) pra não depender só do hardware.
 */
export async function finalizarAspiradoresVencidos(machineId?: string): Promise<void> {
  const ativos = await prisma.vacuumUse.findMany({
    where: { status: "ACTIVE", ...(machineId ? { machineId } : {}) },
  });
  const vencidos = ativos.filter(
    (u) => u.startedAt && Date.now() - u.startedAt.getTime() >= u.durationSec * 1000
  );
  if (vencidos.length === 0) return;
  await prisma.vacuumUse.updateMany({
    where: { id: { in: vencidos.map((u) => u.id) } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}
