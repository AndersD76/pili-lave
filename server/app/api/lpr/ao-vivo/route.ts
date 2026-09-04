import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { readFrame } from "@/lib/frames";

/**
 * Câmera ao vivo para o CLIENTE acompanhar a própria lavagem.
 *
 * Sem `?img`: devolve os metadados da última captura (id e horário) — a tela
 * consulta de tempos em tempos e troca a imagem quando o id muda.
 * Com `?img=<id>`: devolve o JPEG daquela captura.
 *
 * Só libera enquanto o cliente TEM lavagem em andamento (reserva viva). Fora
 * disso a câmera do pátio não é dele para ver — filma quem estiver na frente.
 */
async function podeVer(userId: string): Promise<boolean> {
  const r = await prisma.reservation.findFirst({
    where: { userId, status: { in: ["HELD", "ACTIVE", "ENTERED"] } },
    select: { id: true },
  });
  return !!r;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  if (!(await podeVer(auth.user.id)))
    return NextResponse.json({ error: "Sem lavagem em andamento" }, { status: 403 });

  const img = req.nextUrl.searchParams.get("img");
  if (img) {
    const buf = await readFrame(img);
    if (!buf) return NextResponse.json({ error: "Captura não encontrada" }, { status: 404 });
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=60" },
    });
  }

  const c = await prisma.capture.findFirst({
    orderBy: { at: "desc" },
    select: { id: true, at: true, plate: true, clientName: true },
  });
  if (!c) return NextResponse.json({ frame: null });
  return NextResponse.json(
    { frame: { id: c.id, at: c.at.toISOString(), plate: c.plate, clientName: c.clientName } },
    { headers: { "Cache-Control": "no-store" } }
  );
}
