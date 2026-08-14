/** PILI LAVE — tokens da marca (design/BRAND.md). Dark-first. */
export const C = {
  verniz: "#0B1418",
  verniz2: "#122029",
  verniz3: "#182B35",
  cromo: "#EAF4F6",
  jato: "#25CFDE",
  jatoInk: "#0B7C89",
  pili: "#E23D2E",
  aco: "#54666C",
  acoD: "#8FA3A9",
  espuma: "#F4F9FA",
  linha: "rgba(37,207,222,0.14)",
  ok: "#2FBF71",
  atencao: "#E9A23B",
  erro: "#C9403C",
} as const;

export const F = {
  display: "Sora_700Bold",
  displayX: "Sora_800ExtraBold",
  body: "PublicSans_400Regular",
  bodyBold: "PublicSans_600SemiBold",
} as const;

export function money(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

export function fmtPlate(plate: string): string {
  return plate.length === 7 ? `${plate.slice(0, 3)} ${plate.slice(3)}` : plate;
}
