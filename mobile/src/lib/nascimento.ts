/** Marcada pelo cadastro: a primeira ida pra lavagem passa pelo onboarding
 *  (chave do SecureStore, lida na tela de escolha). */
export const ONBOARDING_PENDENTE = "pililave_onboarding_pendente";

/** Máscara de digitação: só números, vira "DD/MM/AAAA" conforme a pessoa digita. */
export function mascaraNascimento(texto: string): string {
  const d = texto.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** "DD/MM/AAAA" → "AAAA-MM-DD" (formato da API); null enquanto incompleto.
 *  Se a data existe de verdade quem confere é o servidor. */
export function nascimentoParaApi(texto: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
