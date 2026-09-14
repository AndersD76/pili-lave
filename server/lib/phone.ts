/** Normaliza para E.164 Brasil: aceita "54999648368", "(54) 99964-8368", "+55…". */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const national = digits.startsWith("55") ? digits.slice(2) : digits;
  if (national.length < 10 || national.length > 11) return null;
  return `+55${national}`;
}
