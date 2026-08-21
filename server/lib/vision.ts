/**
 * Reconhecimento de placa a partir de FOTO (roda no servidor — a
 * ESP32-CAM só tira a foto e manda os bytes).
 *
 * Estratégias, na ordem:
 *  1. PLATE_VISION_TOKEN definido -> Plate Recognizer (precisão alta,
 *     free tier ~2500 leituras/mês em platerecognizer.com).
 *  2. Fallback: OCR local com tesseract.js (funciona sem chave nenhuma;
 *     precisão menor — exige foto razoavelmente frontal e nítida).
 */
import { isValidPlate, normalizePlate, plateCandidates } from "./placa";

/** Varre o texto do OCR em janelas de 7 caracteres aceitando sósias
 *  (TZFOF36 -> TZF0F36) — a coerção fica em plateCandidates(). */
function extractPlate(text: string): string | null {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (let i = 0; i + 7 <= clean.length; i++) {
    const win = clean.slice(i, i + 7);
    const cands = plateCandidates(win);
    if (cands.length) return cands[0];
  }
  return null;
}

/* FASE DE TESTE: token do Plate Recognizer embutido como fallback para o
 * deploy funcionar sem configurar variável. REMOVER antes de produção e
 * regenerar o token no painel platerecognizer.com. */
const PLATE_TOKEN_TESTE = "f91cc62bd0d61dbfb31b642b613389503c9d4ba5";

function visionToken(): string | undefined {
  return process.env.PLATE_RECOGNIZER_TOKEN || process.env.PLATE_VISION_TOKEN || PLATE_TOKEN_TESTE;
}

async function viaPlateRecognizer(jpeg: Buffer): Promise<string | null> {
  const form = new FormData();
  form.append("upload", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "frame.jpg");
  form.append("regions", "br");
  const res = await fetch("https://api.platerecognizer.com/v1/plate-reader/", {
    method: "POST",
    headers: { Authorization: `Token ${visionToken()}` },
    body: form,
  });
  if (!res.ok) {
    console.error("PlateRecognizer falhou:", res.status, await res.text().catch(() => ""));
    return null;
  }
  const json = await res.json();
  const raw = json?.results?.[0]?.plate as string | undefined;
  return raw ? normalizePlate(raw) : null;
}

/** Limpeza da imagem ANTES do OCR (tudo no servidor — a CAM manda cru):
 *  cinza -> contraste normalizado -> nitidez -> upscale p/ 1600px. */
async function preprocess(jpeg: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(jpeg)
    .rotate() // respeita EXIF
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.2 })
    .resize({ width: 1600, withoutEnlargement: false })
    .jpeg({ quality: 92 })
    .toBuffer();
}

// worker do tesseract reutilizado entre requisições
let tessWorker: import("tesseract.js").Worker | null = null;

async function viaTesseract(jpeg: Buffer): Promise<string | null> {
  const { createWorker } = await import("tesseract.js");
  if (!tessWorker) {
    tessWorker = await createWorker("eng", 1, { cachePath: "/tmp" });
    await tessWorker.setParameters({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      user_defined_dpi: "300",
    });
  }
  const clean = await preprocess(jpeg).catch(() => jpeg);
  const { data } = await tessWorker.recognize(clean);
  return extractPlate(data.text || "");
}

/** Devolve a placa normalizada encontrada na foto, ou null. */
export async function recognizePlate(jpeg: Buffer): Promise<string | null> {
  let plate: string | null = null;
  if (visionToken()) {
    plate = await viaPlateRecognizer(jpeg).catch(() => null);
  }
  if (!plate) {
    plate = await viaTesseract(jpeg).catch((e) => {
      console.error("Tesseract falhou:", e);
      return null;
    });
  }
  if (!plate) return null;
  if (isValidPlate(plate)) return plate;
  return plateCandidates(plate)[0] ?? null;
}
