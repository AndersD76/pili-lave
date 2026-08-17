import { NextRequest, NextResponse } from "next/server";
import { expireStale } from "@/lib/reservations";

/**
 * Cron (Railway, a cada 5 min): expira reservas vencidas, devolve ACTIVE
 * sem X14 para HELD, marca ENTERED travadas como FAILED e máquinas sem
 * heartbeat como OFFLINE. Auth: header x-cron-secret = CRON_SECRET
 * (sem CRON_SECRET no ambiente, fica aberto — fase de teste).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await expireStale();
  return NextResponse.json({ ok: true, ...result });
}
