import { NextRequest, NextResponse } from "next/server";
import { requireDevice } from "@/lib/device";
import { normalizePlate, plateCandidates } from "@/lib/placa";
import { handlePlateRead } from "@/lib/lpr";

/**
 * Câmera dedicada (ESP32-CAM / futura câmera IP): envia o FRAME JPEG cru;
 * o reconhecimento roda aqui na nuvem (Plate Recognizer). Trocar o
 * dispositivo de captura nunca muda o backend — só quem chama este endpoint.
 * Requer PLATE_RECOGNIZER_TOKEN no ambiente.
 */
export async function POST(req: NextRequest) {
  const denied = requireDevice(req);
  if (denied) return denied;

  const token = process.env.PLATE_RECOGNIZER_TOKEN;
  if (!token)
    return NextResponse.json({ error: "PLATE_RECOGNIZER_TOKEN não configurado" }, { status: 501 });

  const jpeg = Buffer.from(await req.arrayBuffer());
  if (jpeg.length < 1000)
    return NextResponse.json({ error: "frame vazio ou pequeno demais" }, { status: 400 });

  const form = new FormData();
  form.append("upload", new Blob([jpeg], { type: "image/jpeg" }), "frame.jpg");
  form.append("regions", "br");

  const res = await fetch("https://api.platerecognizer.com/v1/plate-reader/", {
    method: "POST",
    headers: { Authorization: `Token ${token}` },
    body: form,
  });
  if (!res.ok) {
    console.error("plate-reader:", res.status, await res.text().catch(() => ""));
    return NextResponse.json({ error: "reconhecimento indisponível" }, { status: 502 });
  }

  const data = (await res.json()) as { results?: { plate: string; score: number }[] };
  const best = data.results?.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 0.7)
    return NextResponse.json({ plate: null, light: null }); // sem placa confiável no frame

  const plate = normalizePlate(best.plate);
  if (plateCandidates(plate).length === 0) return NextResponse.json({ plate, light: null });

  const result = await handlePlateRead(plate);
  return NextResponse.json({ plate, ...result });
}
