import { NextRequest, NextResponse } from "next/server";
import { expireStale } from "@/lib/reservations";
import { verificarEAlertar } from "@/lib/saude";

/**
 * Cron (Railway, a cada 5 min): expira reservas vencidas, devolve ACTIVE
 * sem X14 para HELD, marca ENTERED travadas como FAILED e máquinas sem
 * heartbeat como OFFLINE. Também verifica a saúde da operação (display
 * mudo, câmera parada, máquina em falha) e alerta o admin — assim o
 * problema aparece mesmo sem ninguém com o painel aberto.
 * Auth: header x-cron-secret = CRON_SECRET
 * (sem CRON_SECRET no ambiente, fica aberto — fase de teste).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await expireStale();
  const saude = await verificarEAlertar();
  return NextResponse.json({
    ok: true,
    ...result,
    saude: { disponivel: saude.disponivel, problemas: saude.problemas },
  });
}
