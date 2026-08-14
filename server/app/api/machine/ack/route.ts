import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireDevice } from "@/lib/device";

const Body = z.object({ arrivalId: z.string() });

/** Máquina confirma: luz verde acesa, lavagem iniciada. */
export async function POST(req: NextRequest) {
  const denied = requireDevice(req);
  if (denied) return denied;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "arrivalId obrigatório" }, { status: 400 });

  const upd = await prisma.arrival.updateMany({
    where: { id: parsed.data.arrivalId, status: "REQUESTED" },
    data: { status: "STARTED", startedAt: new Date() },
  });
  if (upd.count === 0) return NextResponse.json({ error: "chegada não está liberada" }, { status: 409 });

  const arrival = await prisma.arrival.findUniqueOrThrow({ where: { id: parsed.data.arrivalId } });
  if (arrival.orderId) {
    await prisma.order.updateMany({
      where: { id: arrival.orderId, status: "PAID" },
      data: { status: "REDEEMED", redeemedAt: new Date() },
    });
  }
  await prisma.event.create({
    data: { type: "machine_started", payload: { arrivalId: arrival.id, plate: arrival.plate } },
  });
  return NextResponse.json({ ok: true });
}
