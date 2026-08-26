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
  // limiares baixos de DETECÇÃO (placa pequena/torta ainda é achada);
  // a confiança dos caracteres continua filtrada por MIN_SCORE aqui.
  form.append("config", JSON.stringify({ threshold_d: 0.15, threshold_o: 0.4 }));
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
  type R = { plate: string; score: number; dscore?: number };
  const results = ((json?.results ?? []) as R[]).sort((a, b) => b.score - a.score);
  const best = results[0];
  if (!best) return null;
  // filtro de confiança: leitura fraca (foco, reflexo, ângulo) é descartada
  if (best.score < MIN_SCORE || (best.dscore ?? 1) < MIN_DSCORE) {
    console.warn(`PlateRecognizer: leitura rejeitada ${best.plate} score=${best.score} dscore=${best.dscore}`);
    return null;
  }
  lastScore = best.score;
  return normalizePlate(best.plate);
}

const MIN_SCORE = 0.8;   // confiança dos caracteres
const MIN_DSCORE = 0.5;  // confiança da detecção da placa

/**
 * "Pegar de qualquer jeito": câmera deitada, de lado, placa pequena.
 * Varre variantes do frame até achar: original -> ampliado 2x -> girado
 * 90/270/180 (ampliado). Com LPR_ROTATE fixo (câmera instalada de lado),
 * usa só essa rotação e economiza chamadas.
 */
async function recognizeAnyOrientation(jpeg: Buffer): Promise<string | null> {
  const sharp = (await import("sharp")).default;
  const fixed = process.env.LPR_ROTATE ? Number(process.env.LPR_ROTATE) : null;
  const variants: { rot: number; scale: number }[] = fixed !== null
    ? [{ rot: fixed, scale: 1 }, { rot: fixed, scale: 2 }]
    : [{ rot: 0, scale: 1 }, { rot: 0, scale: 2 }, { rot: 90, scale: 2 }, { rot: 270, scale: 2 }, { rot: 180, scale: 2 }];

  // Placa de cabeça para baixo pode gerar leitura ERRADA com score médio
  // (ex.: 0.83). Por isso: guarda a melhor leitura entre as variantes e só
  // para cedo quando a confiança é quase certeza (>= 0.95).
  let best: { plate: string; score: number; rot: number; scale: number } | null = null;
  for (const v of variants) {
    let img = jpeg;
    if (v.rot || v.scale !== 1) {
      const meta = await sharp(jpeg).metadata();
      let s = sharp(jpeg).rotate(v.rot);
      if (v.scale !== 1 && meta.width) s = s.resize({ width: Math.min(2560, meta.width * v.scale), kernel: "lanczos3" });
      img = await s.sharpen({ sigma: 0.8 }).jpeg({ quality: 92 }).toBuffer();
    }
    const plate = await viaPlateRecognizer(img).catch(() => null);
    if (plate && (!best || lastScore > best.score)) best = { plate, score: lastScore, rot: v.rot, scale: v.scale };
    if (best && best.score >= 0.95) break;
  }
  if (!best) return null;
  lastScore = best.score;
  if (best.rot || best.scale !== 1) console.log(`LPR: ${best.plate} (${best.score}) com rot=${best.rot} scale=${best.scale}`);
  return best.plate;
}
let lastScore = 0;
/** Confiança da última leitura aceita (0..1). */
export function lastPlateScore(): number { return lastScore; }

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
  lastScore = 0;
  if (visionToken()) {
    // com Plate Recognizer configurado, NÃO cai no tesseract: o fallback
    // gera chutes (score 0) que só atrapalham a confirmação
    return recognizeAnyOrientation(jpeg);
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
