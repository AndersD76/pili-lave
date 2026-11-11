import { ROSTO_URL } from "./config";
import { obterTokenLocal } from "./tokenLocal";

/* Chamadas pro serviço de reconhecimento facial (pasta rosto/), que roda
 * neste mesmo computador. Ele pode estar desligado: toda função aqui
 * devolve um resultado "fora do ar" em vez de estourar erro, e quem chama
 * segue pelo caminho sem rosto. */

async function chamar(metodo: "POST" | "DELETE", caminho: string, corpo: unknown, timeoutMs: number) {
  try {
    const res = await fetch(ROSTO_URL.replace(/\/$/, "") + caminho, {
      method: metodo,
      headers: { "x-loja-token": await obterTokenLocal(), ...(corpo ? { "Content-Type": "application/json" } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { alcancou: true as const, ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
  } catch {
    return { alcancou: false as const, ok: false, status: 0, json: null };
  }
}

export type Identificacao =
  | { situacao: "OK"; clienteId: string; score: number }
  | { situacao: "SEM_ROSTO" } // nenhum rosto na imagem
  | { situacao: "NAO_RECONHECIDO" } // tem rosto, mas não é de nenhum candidato
  | { situacao: "FORA_DO_AR" };

/** Quem é este rosto, SÓ entre os candidatos (quem está dentro da loja). */
export async function identificarRosto(imagemBase64: string, candidatos: string[]): Promise<Identificacao> {
  const r = await chamar("POST", "/identificar", { imagemBase64, candidatos }, 8000);
  if (!r.alcancou || r.status >= 500) return { situacao: "FORA_DO_AR" };
  const j = r.json ?? {};
  if (r.ok && j.encontrado && typeof j.clienteId === "string" && candidatos.includes(j.clienteId))
    return { situacao: "OK", clienteId: j.clienteId, score: Number(j.score ?? 0) };
  // o serviço avisa "sem rosto" por um destes jeitos (o contrato básico só
  // tem `encontrado`; aceitar os três evita depender de um detalhe dele)
  if (r.status === 422 || j.semRosto === true || j.rostos === 0 || /SEM_ROSTO/i.test(String(j.motivo ?? j.erro ?? j.detail ?? "")))
    return { situacao: "SEM_ROSTO" };
  return { situacao: "NAO_RECONHECIDO" };
}

/** Cadastra (ou troca) o rosto de um cliente. A foto só passa por aqui: não
 *  é gravada no disco da loja. */
export async function cadastrarRosto(clienteId: string, imagemBase64: string): Promise<"OK" | "RECUSADO" | "FORA_DO_AR"> {
  const r = await chamar("POST", "/cadastrar", { clienteId, imagemBase64 }, 20000);
  if (!r.alcancou || r.status >= 500) return "FORA_DO_AR";
  return r.ok ? "OK" : "RECUSADO"; // recusado = foto sem rosto aproveitável
}

export async function removerRosto(clienteId: string): Promise<boolean> {
  const r = await chamar("DELETE", `/clientes/${encodeURIComponent(clienteId)}`, null, 8000);
  return r.alcancou && (r.ok || r.status === 404);
}

/** Resposta de /api/caixa/rosto pra tela do caixa. */
export type IdentificacaoCaixa =
  /** Ninguém com entrada registrada: o caixa segue sem identificar (como antes da porta existir). */
  | { situacao: "NINGUEM" }
  | { situacao: "OK"; visitaId: string; nome: string }
  /** Nenhum rosto na imagem: "Fique em frente à tela…" e tenta de novo. */
  | { situacao: "SEM_ROSTO"; visitas: { visitaId: string; nome: string }[] }
  /** Sem imagem, serviço fora do ar ou rosto não reconhecido: "Você é: …?". */
  | { situacao: "ESCOLHER"; visitas: { visitaId: string; nome: string }[] };
