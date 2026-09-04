/**
 * Validação de placa em duas camadas:
 * 1. Formato (sempre): padrão antigo ABC1234 e Mercosul ABC1D23.
 * 2. Consulta de dados (opcional, PLACA_PROVIDER): preenche marca/modelo/cor/ano.
 *    Providers free-tier: apibrasil (7/dia grátis), placaapi (10 de teste).
 *    Com "none", o cadastro segue só com o formato validado.
 */

export function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidPlate(plate: string): boolean {
  return /^[A-Z]{3}[0-9]{4}$/.test(plate) || /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(plate);
}

/* OCR e digitação confundem caracteres parecidos (O↔0, I↔1, B↔8…).
 * Coerção por posição: cada formato de placa diz se a posição é letra ou
 * dígito, então convertemos o sósia para o tipo exigido. */
const TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "8": "B" };
const TO_DIGIT: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", G: "6", B: "8" };

/* Trocar sósia demais transforma QUALQUER texto em "placa": letreiro de
 * fachada como AULIC0S virava AUL1C05 e liberava a cancela. Limite de
 * MAX_TROCAS mantém a correção de OCR sem inventar placa. */
const MAX_TROCAS = 1;

function coerce(raw: string, pattern: ("L" | "D")[]): string | null {
  if (raw.length !== pattern.length) return null;
  let out = "";
  let trocas = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (pattern[i] === "L") {
      if (/[A-Z]/.test(ch)) out += ch;
      else if (TO_LETTER[ch]) { out += TO_LETTER[ch]; trocas++; }
      else return null;
    } else {
      if (/[0-9]/.test(ch)) out += ch;
      else if (TO_DIGIT[ch]) { out += TO_DIGIT[ch]; trocas++; }
      else return null;
    }
    if (trocas > MAX_TROCAS) return null;
  }
  return out;
}

/** Candidatas plausíveis para uma leitura: a própria placa (se válida) +
 *  correções de sósia nos formatos antigo (LLLDDDD) e Mercosul (LLLDLDD). */
export function plateCandidates(raw: string): string[] {
  const plate = normalizePlate(raw);
  const out = new Set<string>();
  if (isValidPlate(plate)) out.add(plate);
  const antigo = coerce(plate, ["L", "L", "L", "D", "D", "D", "D"]);
  if (antigo) out.add(antigo);
  const mercosul = coerce(plate, ["L", "L", "L", "D", "L", "D", "D"]);
  if (mercosul) out.add(mercosul);
  return [...out];
}

export type PlateInfo = { brand?: string; model?: string; color?: string; year?: string };

export async function lookupPlate(plate: string): Promise<PlateInfo | null> {
  const provider = process.env.PLACA_PROVIDER ?? "none";
  try {
    if (provider === "apibrasil") {
      // https://apibrasil.com.br — Bearer + DeviceToken; free tier limitado/dia
      const res = await fetch("https://gateway.apibrasil.io/api/v2/vehicles/dados", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.PLACA_API_KEY}`,
          DeviceToken: process.env.PLACA_DEVICE_TOKEN ?? "",
        },
        body: JSON.stringify({ placa: plate }),
      });
      if (!res.ok) return null;
      const j = await res.json();
      const d = j?.response ?? j?.dados ?? j;
      return {
        brand: d?.marca ?? d?.MARCA,
        model: d?.modelo ?? d?.MODELO,
        color: d?.cor ?? d?.cor_veiculo,
        year: String(d?.ano ?? d?.anoModelo ?? ""),
      };
    }
    if (provider === "placaapi") {
      // https://www.placaapi.com — XML/JSON por usuário+senha; 10 consultas de teste
      const res = await fetch(
        `https://www.placaapi.com/api/reg.asmx/CheckBrazil?RegistrationNumber=${plate}&username=${process.env.PLACA_API_KEY}`
      );
      if (!res.ok) return null;
      const text = await res.text();
      const json = /\{[\s\S]*\}/.exec(text)?.[0];
      if (!json) return null;
      const d = JSON.parse(json);
      return { brand: d?.CarMake?.CurrentTextValue, model: d?.CarModel?.CurrentTextValue, color: d?.Colour, year: d?.RegistrationYear };
    }
  } catch (e) {
    console.error("Consulta de placa falhou:", e);
  }
  return null;
}
