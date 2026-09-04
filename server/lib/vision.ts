/**
 * Reconhecimento de placa a partir de FOTO (roda no servidor — a
 * ESP32-CAM só tira a foto e manda os bytes).
 *
 *  1. Plate Recognizer (token em PLATE_RECOGNIZER_TOKEN) com varredura de
 *     orientação (câmera deitada/de lado) e ampliação.
 *  2. Placa LONGE: o detector devolve a caixa mesmo sem conseguir ler;
 *     recortamos a caixa, ampliamos 4x, realçamos e lemos de novo.
 *  3. Sem token: fallback grátis com tesseract (fraco; só para bancada).
 */
import { isValidPlate, normalizePlate, plateCandidates } from "./placa";

const MIN_SCORE = 0.8;   // confiança dos caracteres p/ aceitar
const MIN_DSCORE = 0.3;  // confiança mínima da DETECÇÃO p/ tentar o recorte

let lastScore = 0;
let lastGood: string | null = null; // variante que leu por último (aprendizado)
let lastGoodAt = 0;                 // quando aprendeu (o atalho expira)
const LASTGOOD_TTL_MS = 10 * 60_000; // 10 min: sobrevive à remontagem da câmera
/** Confiança da última leitura aceita (0..1). */
export function lastPlateScore(): number { return lastScore; }

/* FASE DE TESTE: token do Plate Recognizer embutido como fallback para o
 * deploy funcionar sem configurar variável. REMOVER antes de produção e
 * regenerar o token no painel platerecognizer.com. */
const PLATE_TOKEN_TESTE = "f91cc62bd0d61dbfb31b642b613389503c9d4ba5";

function visionToken(): string | undefined {
  return process.env.PLATE_RECOGNIZER_TOKEN || process.env.PLATE_VISION_TOKEN || PLATE_TOKEN_TESTE;
}

type PrResult = { plate: string; score: number; dscore: number; box: { xmin: number; ymin: number; xmax: number; ymax: number } | null };

/** Uma chamada crua ao Plate Recognizer: melhor resultado, sem filtrar. */
async function prCall(jpeg: Buffer): Promise<PrResult | null> {
  const form = new FormData();
  form.append("upload", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "frame.jpg");
  form.append("regions", "br");
  // limiares baixos de DETECÇÃO: placa pequena/torta ainda é localizada
  form.append("config", JSON.stringify({ threshold_d: 0.1, threshold_o: 0.3 }));
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
  type R = { plate: string; score: number; dscore?: number; box?: PrResult["box"] };
  const results = ((json?.results ?? []) as R[]).sort((a, b) => b.score - a.score);
  const best = results[0];
  if (!best) return null;
  return { plate: normalizePlate(best.plate), score: best.score, dscore: best.dscore ?? 1, box: best.box ?? null };
}

/** Recorta a caixa da placa com margem, amplia e realça — "zoom digital". */
async function cropZoom(jpeg: Buffer, box: NonNullable<PrResult["box"]>): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(jpeg).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  const bw = box.xmax - box.xmin, bh = box.ymax - box.ymin;
  const mx = bw * 0.6, my = bh * 1.0;
  const left = Math.max(0, Math.floor(box.xmin - mx));
  const top = Math.max(0, Math.floor(box.ymin - my));
  const width = Math.min(W - left, Math.ceil(bw + 2 * mx));
  const height = Math.min(H - top, Math.ceil(bh + 2 * my));
  return sharp(jpeg)
    .extract({ left, top, width, height })
    .resize({ width: Math.max(1200, width * 4), kernel: "lanczos3" })
    .sharpen({ sigma: 1.2 })
    .normalize()
    .jpeg({ quality: 95 })
    .toBuffer();
}

/**
 * "Pegar de qualquer jeito": varre orientações/ampliação; para cada variante,
 * se o detector achou a placa mas não leu bem, faz o recorte ampliado.
 * Guarda a melhor leitura e para cedo quando é quase certeza (>= 0.98).
 */
async function recognizeAnyOrientation(jpeg: Buffer): Promise<string | null> {
  const sharp = (await import("sharp")).default;
  const fixed = process.env.LPR_ROTATE ? Number(process.env.LPR_ROTATE) : null;
  // rot: rotação | scale: ampliação | flop: espelho horizontal (tela/vidro)
  // enh: realce (normalize + gama) p/ escuridão, contraluz e sol forte
  type Variant = { rot: number; scale: number; flop?: boolean; enh?: boolean };
  // frames já vêm em UXGA: sem ampliar o quadro inteiro (lento); o recorte
  // da placa (zoom) é quem amplia quando ela está longe.
  const base: Variant[] = fixed !== null
    ? [{ rot: fixed, scale: 1 }, { rot: fixed, scale: 2 }, { rot: fixed, scale: 2, flop: true }, { rot: fixed, scale: 2, enh: true }]
    : [
        // A câmera fica DEITADA no poste. As SEM espelho vêm primeiro: é a
        // montagem atual (medido na foto ao vivo: rot=90 lê 0.996; as
        // espelhadas leem 0.73 e ainda gastam uma 2ª chamada no zoom).
        { rot: 90, scale: 1 }, { rot: 270, scale: 1 },
        { rot: 90, scale: 1, flop: true }, { rot: 270, scale: 1, flop: true },
        { rot: 0, scale: 1 }, { rot: 180, scale: 1 },
        { rot: 90, scale: 2 }, { rot: 270, scale: 2 },
        { rot: 0, scale: 1, flop: true }, { rot: 180, scale: 1, flop: true },
        { rot: 90, scale: 2, enh: true }, { rot: 270, scale: 2, enh: true },
      ];
  /* Aprende: a variante que funcionou por último vai primeiro (1 chamada).
   * MAS o aprendizado expira: se a câmera é remontada (foi o que aconteceu
   * ao tirarem o espelho), o lastGood antigo passa a liderar a fila com uma
   * orientação errada e as leituras despencam até o servidor reiniciar. */
  const key = (v: Variant) => `${v.rot}|${v.scale}|${v.flop ? 1 : 0}|${v.enh ? 1 : 0}`;
  const aprendidoVale = lastGood && Date.now() - lastGoodAt < LASTGOOD_TTL_MS;
  const variants = aprendidoVale
    ? [...base.filter((v) => key(v) === lastGood), ...base.filter((v) => key(v) !== lastGood)]
    : base;

  type Best = { plate: string; score: number; how: string; k: string };
  const st: { best: Best | null; calls: number } = { best: null, calls: 0 };
  const MAX_CALLS = 6;      // teto de chamadas ao reconhecedor por foto (cota, 1/s)
  const SURE = 0.98;        // para cedo só com quase-certeza
  /* Só entra na disputa o que TEM CARA DE PLACA (formato antigo ou Mercosul,
   * aceitando 1 troca de sósia). Sem isso a orientação errada vencia: numa
   * foto real, "KADTE3" (0.89, lixo espelhado) era gravado na 1ª tentativa e
   * o RYD1E43 legítimo (0.997), lido na 3ª, nem chegava a ser considerado.
   * Empate de placa válida continua sendo decidido pela confiança. */
  const consider = (r: PrResult | null, how: string) => {
    if (!r || r.score < MIN_SCORE) return;
    if (plateCandidates(r.plate).length === 0) return;   // não é placa: descarta
    if (!st.best || r.score > st.best.score) st.best = { plate: r.plate, score: r.score, how, k: curKey };
  };

  let curKey = "";
  for (const v of variants) {
    curKey = key(v);
    let img = jpeg;
    if (v.rot || v.scale !== 1 || v.flop || v.enh) {
      const meta = await sharp(jpeg).metadata();
      let s = sharp(jpeg).rotate(v.rot);
      if (v.flop) s = s.flop();
      if (v.scale !== 1 && meta.width) s = s.resize({ width: Math.min(2560, meta.width * v.scale), kernel: "lanczos3" });
      if (v.enh) s = s.grayscale().normalize().gamma(1.6).clahe({ width: 64, height: 64, maxSlope: 3 });
      img = await s.sharpen({ sigma: v.enh ? 1.4 : 0.8 }).jpeg({ quality: 92 }).toBuffer();
    }
    const how = `rot=${v.rot} scale=${v.scale}${v.flop ? " espelho" : ""}${v.enh ? " realce" : ""}`;
    if (st.calls >= MAX_CALLS) break;
    st.calls++;
    const r = await prCall(img).catch(() => null);
    consider(r, how);
    if (st.best && st.best.score >= SURE) break;

    /* Recorte ampliado só quando a leitura é MUITO fraca (< 0.5): numa
     * orientação errada o detector acha a placa e lê ~0.73, e o zoom
     * gastava a 2ª chamada de cada variante ruim — o orçamento acabava
     * antes de chegar à orientação certa. */
    if (r && r.box && r.dscore >= MIN_DSCORE && r.score < 0.5) {
      const zoom = await cropZoom(img, r.box).catch(() => null);
      if (zoom && st.calls < MAX_CALLS) {
        st.calls++;
        const rz = await prCall(zoom).catch(() => null);
        consider(rz, `${how} +zoom`);
        if (st.best && st.best.score >= SURE) break;
      }
    }
  }
  if (!st.best) return null;
  const b = st.best;
  lastScore = b.score;
  lastGood = b.k;
  lastGoodAt = Date.now();
  console.log(`LPR: ${b.plate} (${b.score.toFixed(2)}) via ${b.how}`);
  return b.plate;
}

/** Limpeza da imagem ANTES do OCR (fallback tesseract). */
async function preprocess(jpeg: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(jpeg).rotate().grayscale().normalize().sharpen({ sigma: 1.2 })
    .resize({ width: 1600, withoutEnlargement: false }).jpeg({ quality: 92 }).toBuffer();
}

/** Varre o texto do OCR em janelas de 7 caracteres aceitando sósias. */
function extractPlate(text: string): string | null {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (let i = 0; i + 7 <= clean.length; i++) {
    const cands = plateCandidates(clean.slice(i, i + 7));
    if (cands.length) return cands[0];
  }
  return null;
}

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
  lastScore = 0;
  if (visionToken()) return recognizeAnyOrientation(jpeg);
  const plate = await viaTesseract(jpeg).catch((e) => { console.error("Tesseract falhou:", e); return null; });
  if (!plate) return null;
  if (isValidPlate(plate)) return plate;
  return plateCandidates(plate)[0] ?? null;
}
