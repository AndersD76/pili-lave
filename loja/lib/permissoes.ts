/** O que um FUNCIONÁRIO pode ser autorizado a fazer — o lojista marca uma a
 *  uma no cadastro do usuário. Lojista não passa por aqui: tem acesso total.
 *  Ver e buscar produtos/estoque não é permissão: todo usuário ativo vê. */
export const PERMISSOES = [
  { chave: "PRODUTOS", rotulo: "Cadastrar e editar produtos" },
  { chave: "PRECO", rotulo: "Alterar preço de venda" },
  { chave: "ENTRADA", rotulo: "Dar entrada de mercadoria" },
  { chave: "PERDA", rotulo: "Registrar perda" },
  { chave: "INVENTARIO", rotulo: "Fazer contagem de inventário" },
  { chave: "RELATORIOS", rotulo: "Ver relatórios" },
] as const;

export type Permissao = (typeof PERMISSOES)[number]["chave"];

const CHAVES = new Set<string>(PERMISSOES.map((p) => p.chave));

/** Lê a lista guardada em Usuario.permissoes (JSON), ignorando o que não
 *  for uma permissão conhecida. */
export function lerPermissoes(json: string): Permissao[] {
  try {
    const lista: unknown = JSON.parse(json);
    return Array.isArray(lista) ? (lista.filter((p) => typeof p === "string" && CHAVES.has(p)) as Permissao[]) : [];
  } catch {
    return [];
  }
}

export type UsuarioGestao = {
  id: string; nome: string; login: string;
  papel: "LOJISTA" | "FUNCIONARIO";
  permissoes: Permissao[];
};

export function pode(usuario: UsuarioGestao, permissao: Permissao): boolean {
  return usuario.papel === "LOJISTA" || usuario.permissoes.includes(permissao);
}

export function rotuloPermissao(permissao: Permissao): string {
  return PERMISSOES.find((p) => p.chave === permissao)?.rotulo ?? permissao;
}
