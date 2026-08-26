import { NextRequest, NextResponse } from "next/server";
import { requireDevice } from "@/lib/device";
import { listFrames } from "@/lib/frames";

/** Lista das últimas capturas (metadados) para a página /capturas. */
export async function GET(req: NextRequest) {
  const denied = requireDevice(req);
  if (denied) return denied;
  return NextResponse.json(listFrames(), { headers: { "Cache-Control": "no-store" } });
}
