/**
 * Leitura de placa com a IA da Anthropic (Claude), usada quando a cota do
 * Plate Recognizer acaba — ou como leitor principal.
 *
 * Por que Claude: lê a placa mesmo com a foto girada, espelhada, de lado ou
 * com sujeira, sem precisar de cota de serviço especializado. Medido nas
 * fotos reais da máquina: acerta RYD1E43 nas montagens de câmera que já
 * existiram, e quando não tem certeza responde "não vi placa" em vez de
 * inventar — que é o comportamento seguro (placa inventada abre a cancela
 * para o carro errado).
 *
 * Economia (a câmera fotografa a cada ~8s, com carro ou sem):
 *  1. cena parada -> nem chama (comparação de miniatura, custo zero);
 *  2. imagem reduzida a 1024px -> ~1200 tokens por leitura;
 *  3. para na primeira orientação que der confiança alta.
 */
import { plateCandidates } from "./placa";

const MODELO = "claude-sonnet-5";      // acerta onde Haiku erra; Opus não compensa aqui
const MIN_CONF = 0.55;                 // abaixo disso trata como "não li"
const CONF_ALTA = 0.8;                 // para a varredura mais cedo
const MAX_CHAMADAS = 3;                // teto por foto

const PROMPT =
  "Leia a placa do veículo nesta foto. A imagem pode estar girada, espelhada " +
  "ou de cabeça para baixo — considere todas as orientações. Placa brasileira: " +
  "3 letras + 4 dígitos (ABC1234) ou Mercosul 3 letras + dígito + letra + 2 " +
  'dígitos (ABC1D23). Responda SOMENTE JSON: {"placa":"XXX0000","confianca":0.0} ' +
  '— confianca de 0 a 1. Se não houver placa legível, {"placa":null,"confianca":0}. ' +
  "Não invente: na dúvida, responda placa null.";

let ultimoScore = 0;
/** Confiança da última leitura aceita (0..1). */
export function ultimaConfianca(): number {
  return ultimoScore;
}

export function temChaveClaude(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

type Leitura = { placa: string | null; conf: number };

/** Uma chamada ao Claude com a imagem. */
async function chamar(jpeg: Buffer): Promise<Leitura | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 120,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    console.error("Claude vision falhou:", res.status, await res.text().catch(() => ""));
    return null;
  }
  const json = await res.json();
  const texto = ((json?.content ?? []) as { type: string; text?: string }[])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  try {
    const o = JSON.parse(texto.replace(/```json|```/g, "").trim());
    const placa = typeof o?.placa === "string" ? o.placa.toUpperCase().replace(/[^A-Z0-9]/g, "") : null;
    return { placa: placa || null, conf: Number(o?.confianca) || 0 };
  } catch {
    return null;
  }
}

/**
 * Lê a placa varrendo orientações. A câmera já foi remontada duas vezes
 * (espelhada e não espelhada), então as duas entram na varredura.
 */
export async function lerPlacaComClaude(jpeg: Buffer): Promise<string | null> {
  ultimoScore = 0;
  if (!temChaveClaude()) return null;
  const sharp = (await import("sharp")).default;

  const variantes: { flop: boolean; rot: number }[] = [
    { flop: false, rot: 0 },
    { flop: true, rot: 0 },
    { flop: false, rot: 180 },
  ];

  let melhor: Leitura | null = null;
  let chamadas = 0;

  for (const v of variantes) {
    if (chamadas >= MAX_CHAMADAS) break;
    let s = sharp(jpeg).rotate().resize({ width: 1024, withoutEnlargement: true });
    if (v.flop) s = s.flop();
    if (v.rot) s = s.rotate(v.rot);
    const img = await s.jpeg({ quality: 88 }).toBuffer();

    chamadas++;
    const r = await chamar(img).catch(() => null);
    if (!r?.placa) continue;
    // só conta o que TEM CARA DE PLACA — não deixa texto de fachada virar placa
    if (plateCandidates(r.placa).length === 0) continue;
    if (!melhor || r.conf > melhor.conf) melhor = r;
    if (melhor.conf >= CONF_ALTA) break;
  }

  if (!melhor || melhor.conf < MIN_CONF) return null;
  ultimoScore = melhor.conf;
  const placa = plateCandidates(melhor.placa!)[0] ?? melhor.placa!;
  console.log(`LPR(Claude): ${placa} (${melhor.conf.toFixed(2)}) em ${chamadas} chamada(s)`);
  return placa;
}

/* ── Filtro de cena: evita gastar leitura com o pátio vazio ──────────────
 * A câmera manda foto a cada ~8s tenha carro ou não. Uma miniatura em cinza
 * resume a cena; se a cena não mudou desde a última análise, não há carro
 * novo para ler. Custo zero (roda no servidor, sem chamada externa). */
let assinaturaAnterior: Buffer | null = null;
let ultimaAnaliseEm = 0;
const DIFERENCA_MINIMA = 12;      // média por pixel (0-255) que conta como mudança
const ANALISE_FORCADA_MS = 60_000; // no mínimo 1 análise por minuto, mesmo parada

export async function cenaMudou(jpeg: Buffer): Promise<boolean> {
  const sharp = (await import("sharp")).default;
  const agora = Date.now();
  try {
    const { data } = await sharp(jpeg)
      .rotate().grayscale().resize({ width: 32, height: 24, fit: "fill" })
      .normalize().raw().toBuffer({ resolveWithObject: true });
    const atual = Buffer.from(data);
    const anterior = assinaturaAnterior;
    assinaturaAnterior = atual;

    if (!anterior || anterior.length !== atual.length) {
      ultimaAnaliseEm = agora;
      return true;
    }
    let soma = 0;
    for (let i = 0; i < atual.length; i++) soma += Math.abs(atual[i] - anterior[i]);
    const dif = soma / atual.length;

    if (dif >= DIFERENCA_MINIMA || agora - ultimaAnaliseEm >= ANALISE_FORCADA_MS) {
      ultimaAnaliseEm = agora;
      return true;
    }
    return false;
  } catch {
    return true; // na dúvida, analisa
  }
}
