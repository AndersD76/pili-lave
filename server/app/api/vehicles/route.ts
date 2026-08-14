import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { isValidPlate, lookupPlate, normalizePlate } from "@/lib/placa";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const vehicles = await prisma.vehicle.findMany({
    where: { userId: auth.user.id },
    include: { defaultProgram: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(vehicles);
}

const Body = z.object({
  plate: z.string().min(7).max(8),
  model: z.string().max(60).optional(),
  defaultProgramId: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const plate = normalizePlate(parsed.data.plate);
  if (!isValidPlate(plate))
    return NextResponse.json({ error: "Placa inválida. Use o formato ABC1234 ou ABC1D23." }, { status: 400 });

  const exists = await prisma.vehicle.findUnique({
    where: { userId_plate: { userId: auth.user.id, plate } },
  });
  if (exists) return NextResponse.json({ error: "Placa já cadastrada" }, { status: 409 });

  const info = await lookupPlate(plate); // null se PLACA_PROVIDER=none ou falha
  const vehicle = await prisma.vehicle.create({
    data: {
      userId: auth.user.id,
      plate,
      model: parsed.data.model ?? info?.model ?? null,
      brand: info?.brand ?? null,
      color: info?.color ?? null,
      year: info?.year ?? null,
      defaultProgramId: parsed.data.defaultProgramId ?? null,
    },
  });
  await prisma.event.create({ data: { type: "vehicle_created", payload: { userId: auth.user.id, plate } } });
  return NextResponse.json(vehicle, { status: 201 });
}
