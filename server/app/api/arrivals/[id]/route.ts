import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const arrival = await prisma.arrival.findFirst({
    where: { id, userId: auth.user.id },
    include: { vehicle: { select: { plate: true, defaultProgramId: true } } },
  });
  if (!arrival) return NextResponse.json({ error: "Chegada não encontrada" }, { status: 404 });
  return NextResponse.json(arrival);
}
