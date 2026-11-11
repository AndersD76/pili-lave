import { NextRequest, NextResponse } from "next/server";
import { conferirTokenLocal } from "@/lib/tokenLocal";
import { visitasAtivas } from "@/lib/visitas";

/** Quem está dentro da loja agora — as câmeras usam pra dar nome às pessoas
 *  que acompanham, e o reconhecimento pra saber entre quem procurar. */
export async function GET(req: NextRequest) {
  if (!(await conferirTokenLocal(req))) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const visitas = await visitasAtivas();
  return NextResponse.json(
    visitas.map((v) => ({
      visitaId: v.id, nuvemUserId: v.nuvemUserId, codigoCliente: v.codigoCliente, nome: v.nome, entrouEm: v.entrouEm.toISOString(),
    }))
  );
}
