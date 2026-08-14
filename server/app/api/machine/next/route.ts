import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDevice } from "@/lib/device";

/** Máquina pergunta: "tem lavagem liberada?" (polling a cada ~2 s). */
export async function GET(req: NextRequest) {
  const denied = requireDevice(req);
  if (denied) return denied;

  const arrival = await prisma.arrival.findFirst({
    where: { status: "REQUESTED" },
    orderBy: { requestedAt: "asc" },
    include: { order: { include: { program: true } } },
  });
  if (!arrival) return NextResponse.json({ job: null });

  return NextResponse.json({
    job: {
      arrivalId: arrival.id,
      plate: arrival.plate,
      programId: arrival.order?.programId ?? 0,
      programa: arrival.order?.program.nome ?? "",
    },
  });
}
