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
