import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";

const Body = z.object({ deviceKey: z.string().min(1) });

export async function POST(req: NextRequest) {
  if (!(await isAdmin()))
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "deviceKey obrigatório" }, { status: 400 });

  const machine = await prisma.machine.findUnique({
    where: { deviceKey: parsed.data.deviceKey },
  });
  if (!machine)
    return NextResponse.json({ error: "Máquina não encontrada" }, { status: 404 });

  await prisma.machine.update({
    where: { id: machine.id },
    data: { lastPaymentDate: new Date() },
  });

  return NextResponse.json({ ok: true, deviceKey: parsed.data.deviceKey });
}
