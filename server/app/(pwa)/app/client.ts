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

export type TipoParceiro = "LAVADOR" | "COMISSAO1" | "COMISSAO2" | "ALUGUEL" | "DONO_LOJA";
export type StatusSolicitacao = "PENDENTE" | "APROVADA" | "REJEITADA";
export type Solicitacao = { tipo: TipoParceiro; status: StatusSolicitacao };

export type Me = {
  id: string; phone: string; email: string | null; name: string | null;
  cpf?: string | null;
  pixChave?: string | null;
  pixTipo?: "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP" | null;
  role: "CLIENT" | "LAVADOR" | "PARCEIRO" | "ADMIN"; walletCents: number;
  solicitacoes?: Solicitacao[];
  // loja de conveniência
  codigoCliente: number;
  nascimento: string | null; // "AAAA-MM-DD"
  termosAceitos: boolean; // aceitou a versão VIGENTE do termo
  temFoto: boolean;
};
export type Program = { id: number; nome: string; descricao?: string | null; precoCents: number };
export type Vehicle = { id: string; plate: string; brand: string | null; model: string | null };
export type Order = {
  id: string; amountCents: number; status: "PAID" | "REDEEMED" | "CANCELED";
  voucherCode: string; createdAt: string;
  program: Program; vehicle: Vehicle | null;
};
export type Machine = {
  id: string; name: string; status: string; remainingSec: number;
  vacuumEnabled: boolean; vacuumPriceCents: number | null; vacuumDurationMin: number | null;
};
export type Station = {
  id: string; name: string; address: string; city: string; state: string;
  situacao: "ABERTO" | "OCUPADO" | "MANUTENCAO" | "INATIVO";
  machines: Machine[];
};
export type VacuumUse = {
  id: string; machineId: string; amountCents: number; durationSec: number;
  status: "PAID" | "ACTIVE" | "COMPLETED";
  startedAt: string | null; completedAt: string | null;
};

/** Mensagem do cliente pro suporte de uma loja (e a resposta do dono). */
export type LojaMensagem = {
  id: string; texto: string; criadaEm: string; resposta: string | null; respondidaEm: string | null;
};
/** Loja de conveniência vista pelo cliente (GET /api/lojas). */
export type Loja = {
  id: string; name: string; address: string; city: string; state: string; capacidade: number;
  bloqueado: boolean;
  mensagens: LojaMensagem[];
};
/** Loja vista pelo dono (GET /api/dono/lojas). */
export type LojaDoDono = {
  id: string; name: string; address: string; city: string; state: string; active: boolean; capacidade: number;
  bloqueios: { id: string; motivo: string; criadoEm: string; cliente: { nome: string | null; codigo: number } }[];
  mensagens: (LojaMensagem & { cliente: { nome: string | null; codigo: number; bloqueado: boolean } })[];
};
