import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ARRIVAL_TTL_MIN } from "@/lib/device";

/** Chegada ativa do usuário (o app faz polling p/ mostrar "seu carro chegou"). */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const cutoff = new Date(Date.now() - ARRIVAL_TTL_MIN * 60_000);
  const arrival = await prisma.arrival.findFirst({
    where: {
      userId: auth.user.id,
      OR: [
        { status: "WAITING_DRIVER", createdAt: { gte: cutoff } },
        { status: { in: ["REQUESTED", "STARTED"] }, createdAt: { gte: new Date(Date.now() - 60 * 60_000) } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: { vehicle: { select: { plate: true, defaultProgramId: true } } },
  });
  return NextResponse.json({ arrival });
}
