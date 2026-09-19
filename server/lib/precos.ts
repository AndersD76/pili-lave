import { prisma } from "@/lib/prisma";

/**
 * Preço efetivo de um programa (tipo de lavagem) para uma unidade
 * específica. Cada unidade pode ter seu próprio preço (StationPrograma);
 * sem override cadastrado, cai no preço padrão do Program (o "modelo"
 * preenchido na aba Preços do admin).
 */
export async function precoEfetivo(programId: number, stationId?: string | null): Promise<number> {
  if (stationId) {
    const override = await prisma.stationPrograma.findUnique({
      where: { stationId_programId: { stationId, programId } },
    });
    if (override) return override.precoCents;
  }
  const program = await prisma.program.findUniqueOrThrow({ where: { id: programId } });
  return program.precoCents;
}
