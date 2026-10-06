import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const Body = z.object({
  vacuumUseId: z.string(),
});

/**
 * Botão "começar agora": vira ACTIVE e marca startedAt. É só a partir daqui
 * que o heartbeat passa a devolver o comando `vacuum` pro display contar o
 * tempo (ver /api/machine/heartbeat). Pago (PAID) não liga nada sozinho.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const use = await prisma.vacuumUse.findFirst({
    where: { id: parsed.data.vacuumUseId, userId: auth.user.id },
  });
  if (!use) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  if (use.status !== "PAID")
    return NextResponse.json({ error: "Este aspirador já foi iniciado ou já expirou." }, { status: 409 });

  const updated = await prisma.vacuumUse.update({
    where: { id: use.id },
    data: { status: "ACTIVE", startedAt: new Date() },
  });
  return NextResponse.json(updated);
}
