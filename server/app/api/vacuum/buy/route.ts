import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const Body = z.object({
  machineId: z.string(),
});

/**
 * Compra do aspirador: debita a carteira e grava VacuumUse em PAID. Pode ser
 * comprado solto (sem lavagem) ou junto — não depende de Order/Reservation.
 * O cliente decide depois (POST /api/vacuum/start) quando começar a contar
 * o tempo, no momento em que estiver pronto para usar.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const machine = await prisma.machine.findUnique({ where: { id: parsed.data.machineId } });
  if (!machine || !machine.vacuumEnabled || !machine.vacuumPriceCents || !machine.vacuumDurationMin)
    return NextResponse.json({ error: "Aspirador não disponível nesta máquina" }, { status: 404 });

  const precoCents = machine.vacuumPriceCents;
  const durationSec = machine.vacuumDurationMin * 60;

  try {
    const use = await prisma.$transaction(async (tx) => {
      const debit = await tx.user.updateMany({
        where: { id: auth.user.id, walletCents: { gte: precoCents } },
        data: { walletCents: { decrement: precoCents } },
      });
      if (debit.count === 0) throw new Error("SALDO");

      const use = await tx.vacuumUse.create({
        data: {
          userId: auth.user.id,
          machineId: machine.id,
          amountCents: precoCents,
          durationSec,
        },
      });
      await tx.walletTx.create({
        data: { userId: auth.user.id, amountCents: -precoCents, kind: "VACUUM", refId: use.id },
      });
      return use;
    });
    return NextResponse.json(use, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message === "SALDO")
      return NextResponse.json({ error: "Saldo insuficiente. Adicione saldo para continuar." }, { status: 402 });
    console.error("Compra de aspirador falhou:", e);
    return NextResponse.json({ error: "Não foi possível concluir. Tente novamente." }, { status: 500 });
  }
}
