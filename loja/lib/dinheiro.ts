/** "R$ 12,50" a partir de centavos. */
export function reais(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

/** "12,50" (sem o R$) — pra preencher campo de formulário. */
export function reaisCampo(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

/** Texto digitado ("12,50", "12.50", "R$ 12") → centavos; null se vazio ou inválido. */
export function centavosDoCampo(v: FormDataEntryValue | null): number | null {
  const texto = String(v ?? "").replace(/[R$\s]/g, "").replace(",", ".");
  if (!texto) return null;
  const n = Number(texto);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/**
 * Campo de preço de venda que aceita dois jeitos de preencher:
 *  - um VALOR: "5,90"  → R$ 5,90
 *  - um PERCENTUAL sobre o custo: "30%" → custo + 30%
 * Devolve os centavos, `null` se o campo veio vazio, ou "INVALIDO".
 */
export function precoDoCampo(v: FormDataEntryValue | null, custoCents: number): number | null | "INVALIDO" {
  const texto = String(v ?? "").replace(/[R$\s]/g, "");
  if (!texto) return null;
  if (texto.endsWith("%")) {
    const pct = Number(texto.slice(0, -1).replace(",", "."));
    if (!Number.isFinite(pct) || pct < 0 || pct > 1000) return "INVALIDO";
    return Math.round(custoCents * (1 + pct / 100));
  }
  return centavosDoCampo(texto) ?? "INVALIDO";
}

/** Inteiro >= 0 digitado num campo; null se vazio ou inválido. */
export function inteiroDoCampo(v: FormDataEntryValue | null): number | null {
  const texto = String(v ?? "").trim();
  if (!/^\d+$/.test(texto)) return null;
  return Number(texto);
}
