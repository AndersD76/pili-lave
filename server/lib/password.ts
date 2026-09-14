import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const MIN_LEN = 8;

/** Critério mínimo: 8+ caracteres, com pelo menos 1 letra e 1 número. */
export function validatePassword(pw: string): string | null {
  if (pw.length < MIN_LEN) return `A senha precisa ter pelo menos ${MIN_LEN} caracteres.`;
  if (!/[a-zA-Z]/.test(pw)) return "A senha precisa ter pelo menos 1 letra.";
  if (!/[0-9]/.test(pw)) return "A senha precisa ter pelo menos 1 número.";
  return null;
}

/** "salt:hash" — scrypt (sem dependência extra; suficiente para o volume do app). */
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, "hex");
  const testBuf = scryptSync(pw, salt, 64);
  return testBuf.length === hashBuf.length && timingSafeEqual(testBuf, hashBuf);
}
