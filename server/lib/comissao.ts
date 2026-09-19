/**
 * Percentual PROVISÓRIO da divisão lavador/admin (ainda não definido de
 * vez — usar até virar configurável por máquina/lavador).
 *
 * Regra de quem já está com o dinheiro na mão:
 *  - Presencial (pago em espécie, botões X1-X6): o LAVADOR já fica com o
 *    dinheiro na hora. Ele deve ao admin a parte que é dele (1 - %lavador).
 *  - App (pago pela carteira do cliente): o ADMIN já fica com o dinheiro
 *    (a carteira desconta na conta da empresa). Ele deve ao lavador a
 *    parte que é dele (%lavador).
 */
export const PERCENTUAL_LAVADOR = 0.55;

export function parteLavador(cents: number): number {
  return Math.round(cents * PERCENTUAL_LAVADOR);
}
export function parteAdmin(cents: number): number {
  return cents - parteLavador(cents);
}

/** Acerto final entre os dois, dado o total presencial e o total app do
 * período. Positivo em "adminDeve" = admin tem que pagar o lavador;
 * positivo em "lavadorDeve" = lavador tem que repassar pro admin. */
export function acertoFinal(totalPresencialCents: number, totalAppCents: number) {
  const lavadorDeveCents = parteAdmin(totalPresencialCents);   // admin cut do dinheiro que o lavador já tem
  const adminDeveCents = parteLavador(totalAppCents);          // parte do lavador no dinheiro que o admin já tem
  const netCents = adminDeveCents - lavadorDeveCents;          // >0: admin paga lavador; <0: lavador paga admin
  return { lavadorDeveCents, adminDeveCents, netCents };
}
