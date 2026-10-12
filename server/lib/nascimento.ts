/** Data de nascimento no formato "AAAA-MM-DD" → Date (meia-noite UTC, que é
 *  como o Postgres guarda um DATE). Devolve null se não for uma data real
 *  ou se estiver fora de uma faixa plausível (1900 até hoje). */
export function parseNascimento(valor: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  // 31/02 e afins: o Date "arruma" sozinho, então confere se voltou igual
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null;
  if (ano < 1900 || data.getTime() > Date.now()) return null;
  return data;
}
