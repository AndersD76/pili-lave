import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { conferirTokenLocal } from "@/lib/tokenLocal";
import { registrarSaida } from "@/lib/visitas";

const Body = z
  .object({ visitaId: z.string().min(1).optional(), nuvemUserId: z.string().min(1).optional() })
  .refine((b) => b.visitaId || b.nuvemUserId, "Informe a visita.");

/** O equipamento da porta avisa que a pessoa saiu. A saída nunca é
 *  barrada: sem compra registrada, só fica marcado e o dono é avisado. */
export async function POST(req: NextRequest) {
  if (!(await conferirTokenLocal(req))) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  const r = await registrarSaida(parsed.data);
  return NextResponse.json(r, { status: r.ok ? 200 : 404 });
}
