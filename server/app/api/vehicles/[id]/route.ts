import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const Body = z.object({
  model: z.string().max(60).optional(),
  defaultProgramId: z.number().int().nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const vehicle = await prisma.vehicle.findFirst({ where: { id, userId: auth.user.id } });
  if (!vehicle) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

  const updated = await prisma.vehicle.update({ where: { id }, data: parsed.data });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const vehicle = await prisma.vehicle.findFirst({ where: { id, userId: auth.user.id } });
  if (!vehicle) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
  await prisma.vehicle.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
