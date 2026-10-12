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
