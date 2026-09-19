import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** ?stationId=<id> devolve o preço PRÓPRIO daquela unidade (quando
 * cadastrado); sem stationId, ou sem preço próprio, devolve o valor padrão
 * do Program (usado antes de escolher a unidade, ex.: pré-visualização). */
export async function GET(req: NextRequest) {
  const stationId = req.nextUrl.searchParams.get("stationId");
  const programs = await prisma.program.findMany({
    where: { ativo: true },
    orderBy: { ordem: "asc" },
  });
  if (!stationId) return NextResponse.json(programs);

  const overrides = await prisma.stationPrograma.findMany({ where: { stationId } });
  const overrideMap = new Map(overrides.map((o) => [o.programId, o.precoCents]));
  const comPrecoDaUnidade = programs.map((p) => ({
    ...p,
    precoCents: overrideMap.get(p.id) ?? p.precoCents,
  }));
  return NextResponse.json(comPrecoDaUnidade);
}
