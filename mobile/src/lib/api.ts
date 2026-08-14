import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

/**
 * Base da API:
 * - produção: EXPO_PUBLIC_API_URL (eas/env)
 * - dev no Expo Go: usa o IP da máquina que roda `npm run dev` do server (porta 3000)
 */
function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return host ? `http://${host}:3000` : "http://localhost:3000";
}

export const API_URL = resolveBaseUrl();
const TOKEN_KEY = "pililave_token";

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}
export async function setToken(token: string | null): Promise<void> {
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
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
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `Erro ${res.status}`);
  return json as T;
}

export type Me = { id: string; phone: string; name: string | null; role: "CLIENT" | "LAVADOR" | "ADMIN"; walletCents: number };
export type Program = { id: number; nome: string; precoCents: number };
export type Vehicle = { id: string; plate: string; brand: string | null; model: string | null; defaultProgramId: number | null };
export type Order = {
  id: string; programId: number; amountCents: number; status: "PAID" | "REDEEMED" | "CANCELED";
  voucherCode: string; createdAt: string; redeemedAt: string | null;
  program: Program; vehicle: Vehicle | null;
};
