/* Chamadas deste computador pro servidor na nuvem (server/): o cadastro da
 * loja no primeiro uso (/api/loja/unidades e /api/loja/provisionar,
 * protegidas pela senha de fábrica) e a conferência do login do lojista
 * (/api/loja/dono-login, identificada pelo deviceKey deste computador). */

export type EnderecoNuvem = {
  lojaId: string | null; stationId: string | null; cidade: string; rua: string; nome: string;
  temComputador: boolean;
};

export type LojaNuvem = { id: string; nome: string; cidade: string; rua: string; capacidade: number; aberta: boolean };

export class ErroNuvem extends Error {
  /** true = a loja já tem outro computador; repetir com substituir=true troca. */
  precisaSubstituir: boolean;
  constructor(mensagem: string, precisaSubstituir = false) {
    super(mensagem);
    this.precisaSubstituir = precisaSubstituir;
  }
}

async function chamar(nuvemUrl: string, caminho: string, senhaFabrica: string, corpo?: unknown) {
  let res: Response;
  try {
    res = await fetch(nuvemUrl.replace(/\/$/, "") + caminho, {
      method: corpo ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "x-provision-secret": senhaFabrica },
      body: corpo ? JSON.stringify(corpo) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ErroNuvem("Não foi possível falar com o servidor. Confira a internet e o endereço do servidor.");
  }
  const json = await res.json().catch(() => null);
  if (res.status === 401) throw new ErroNuvem("Senha de fábrica incorreta.");
  if (!res.ok) throw new ErroNuvem(json?.error ?? `O servidor respondeu erro ${res.status}.`, !!json?.precisaSubstituir);
  return json;
}

export async function buscarEnderecos(nuvemUrl: string, senhaFabrica: string, cidade: string): Promise<EnderecoNuvem[]> {
  const json = await chamar(nuvemUrl, `/api/loja/unidades?cidade=${encodeURIComponent(cidade)}`, senhaFabrica);
  return json.enderecos as EnderecoNuvem[];
}

export async function cadastrarLojaNaNuvem(
  nuvemUrl: string,
  senhaFabrica: string,
  corpo: {
    deviceKey: string; lojaId?: string; stationId?: string; cidade?: string; rua?: string; nome?: string;
    substituir?: boolean;
  }
): Promise<LojaNuvem> {
  const json = await chamar(nuvemUrl, "/api/loja/provisionar", senhaFabrica, corpo);
  return json.loja as LojaNuvem;
}

export type LoginDono =
  | { situacao: "OK"; dono: { id: string; nome: string; email: string } }
  | { situacao: "CREDENCIAIS" } // e-mail ou senha errados
  | { situacao: "NAO_E_DONO" } // conta existe, mas não é a dona desta loja
  | { situacao: "SEM_CONEXAO" }; // nuvem fora do alcance — quem chama decide se entra pelo cache

/** Pergunta à nuvem se esse e-mail e senha são do DONO da loja deste
 *  computador (quem é o dono é definido pelo admin, em /admin/lojas). */
export async function loginDono(nuvemUrl: string, deviceKey: string, email: string, senha: string): Promise<LoginDono> {
  let res: Response;
  try {
    res = await fetch(nuvemUrl.replace(/\/$/, "") + "/api/loja/dono-login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-device-key": deviceKey },
      body: JSON.stringify({ email, password: senha }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return { situacao: "SEM_CONEXAO" };
  }
  if (res.status >= 500) return { situacao: "SEM_CONEXAO" };
  const json = await res.json().catch(() => null);
  if (res.ok && json?.dono) return { situacao: "OK", dono: json.dono };
  if (res.status === 403) return { situacao: "NAO_E_DONO" };
  return { situacao: "CREDENCIAIS" };
}

/* ── Pagamento pela carteira do app ────────────────────────────────────
 * O caixa escaneia o QR que o app mostra (mesmo leitor dos produtos) e
 * chama a nuvem pra identificar o cliente e, confirmado, debitar. As duas
 * chamadas se identificam pelo deviceKey da loja, como o login do lojista. */

async function chamarComDeviceKey(nuvemUrl: string, deviceKey: string, caminho: string, corpo: unknown, timeoutMs: number) {
  let res: Response;
  try {
    res = await fetch(nuvemUrl.replace(/\/$/, "") + caminho, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-device-key": deviceKey },
      body: JSON.stringify(corpo),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false as const, status: 0, json: null };
  }
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export type IdentificarCarteira =
  | { situacao: "OK"; nome: string; walletCents: number }
  | { situacao: "EXPIRADO" } // QR vencido (vale 3 min) — peça pra abrir a tela de novo
  | { situacao: "SEM_CONEXAO" }
  | { situacao: "ERRO"; mensagem: string };

export async function identificarCarteira(nuvemUrl: string, deviceKey: string, token: string): Promise<IdentificarCarteira> {
  const r = await chamarComDeviceKey(nuvemUrl, deviceKey, "/api/loja/pagamento/identificar", { token }, 10000);
  if (r.status === 0) return { situacao: "SEM_CONEXAO" };
  if (r.ok) return { situacao: "OK", nome: r.json.nome, walletCents: r.json.walletCents };
  if (r.status === 410) return { situacao: "EXPIRADO" };
  return { situacao: "ERRO", mensagem: r.json?.error ?? "Não foi possível identificar o cliente." };
}

export type DebitarCarteira =
  | { situacao: "OK" }
  | { situacao: "SALDO_INSUFICIENTE" }
  | { situacao: "EXPIRADO" }
  | { situacao: "SEM_CONEXAO" }
  | { situacao: "ERRO"; mensagem: string };

export async function debitarCarteira(
  nuvemUrl: string, deviceKey: string,
  corpo: { token: string; totalCents: number; vendaCodigo: string; itens: number }
): Promise<DebitarCarteira> {
  const r = await chamarComDeviceKey(nuvemUrl, deviceKey, "/api/loja/pagamento/debitar", corpo, 15000);
  if (r.status === 0) return { situacao: "SEM_CONEXAO" };
  if (r.ok) return { situacao: "OK" };
  if (r.status === 402) return { situacao: "SALDO_INSUFICIENTE" };
  if (r.status === 410) return { situacao: "EXPIRADO" };
  return { situacao: "ERRO", mensagem: r.json?.error ?? "Não foi possível debitar a carteira." };
}

/** Devolve o valor pra carteira — chamada quando o débito foi feito mas a
 *  venda não pôde ser concluída localmente depois (ver finalizarVenda). */
export async function estornarCarteira(nuvemUrl: string, deviceKey: string, vendaCodigo: string): Promise<boolean> {
  const r = await chamarComDeviceKey(nuvemUrl, deviceKey, "/api/loja/pagamento/estornar", { vendaCodigo }, 15000);
  return r.ok;
}

export type ItemVendaSincronizacao = { nome: string; ean: string | null; quantidade: number; precoUnitCents: number };
export type VendaSincronizacao = {
  codigo: string; totalCents: number; forma: string; criadaEm: string; itens: ItemVendaSincronizacao[];
};

/** Manda um lote de vendas pra nuvem (ver lib/sincronizacao.ts). Devolve os
 *  códigos que a nuvem confirmou ter recebido — só esses são marcados como
 *  sincronizados aqui; o resto fica pra tentar de novo na próxima vez. */
export async function sincronizarVendasNuvem(nuvemUrl: string, deviceKey: string, vendas: VendaSincronizacao[]): Promise<string[]> {
  const r = await chamarComDeviceKey(nuvemUrl, deviceKey, "/api/loja/vendas/sincronizar", { vendas }, 20000);
  return r.ok && Array.isArray(r.json?.sincronizados) ? r.json.sincronizados : [];
}

/** Testa se a nuvem está alcançável agora — decide se o caixa oferece
 *  "Carteira do app" (precisa de internet) ou só cartão. */
export async function nuvemAlcancavel(nuvemUrl: string): Promise<boolean> {
  try {
    const res = await fetch(nuvemUrl.replace(/\/$/, "") + "/api/health", { cache: "no-store", signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}
