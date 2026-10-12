/* Comparação de endereço digitado à mão — mesmas regras do cadastro de
 * máquina (/api/machine/provisionar), usadas aqui pelo cadastro de loja. */

/** Remove acentos + maiúsculas + espaços duplicados: "joao carlon" e
 *  "João  Carlon" são o mesmo endereço. */
export function normalizarEndereco(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // tira acentos
    .toLowerCase().trim().replace(/\s+/g, " ");
}

/** Além disso, ignora o prefixo do logradouro (rua, av, avenida, tv,
 *  travessa, r.) — "Joao Carlon" e "Rua João Carlon" são a mesma rua. */
export function normalizarRua(s: string): string {
  return normalizarEndereco(s).replace(/^(rua|r\.|av|av\.|avenida|tv|tv\.|travessa)\s+/, "");
}

/** Chave de comparação cidade+rua. */
export function chaveEndereco(cidade: string, rua: string): string {
  return normalizarEndereco(cidade) + "|" + normalizarRua(rua);
}
