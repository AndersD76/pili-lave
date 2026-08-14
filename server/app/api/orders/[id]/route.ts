import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const order = await prisma.order.findFirst({
    where: { id, userId: auth.user.id },
    include: { program: true, vehicle: true },
  });
  if (!order) return NextResponse.json({ error: "Lavagem não encontrada" }, { status: 404 });
  return NextResponse.json(order);
}
