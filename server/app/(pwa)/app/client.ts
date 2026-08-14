"use client";

/** Helpers do PWA (client-side): token em localStorage + fetch da API. */

const TOKEN_KEY = "pililave_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== false) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string })?.error ?? `Erro ${res.status}`);
  return json as T;
}

export function money(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}
export function fmtPlate(plate: string): string {
  return plate.length === 7 ? `${plate.slice(0, 3)} ${plate.slice(3)}` : plate;
}

export type Me = { id: string; phone: string; name: string | null; role: "CLIENT" | "LAVADOR" | "ADMIN"; walletCents: number };
export type Program = { id: number; nome: string; precoCents: number };
export type Vehicle = { id: string; plate: string; brand: string | null; model: string | null };
export type Order = {
  id: string; amountCents: number; status: "PAID" | "REDEEMED" | "CANCELED";
  voucherCode: string; createdAt: string;
  program: Program; vehicle: Vehicle | null;
};
