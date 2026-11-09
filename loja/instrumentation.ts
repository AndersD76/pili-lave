/**
 * Roda uma vez quando o servidor Next.js sobe (ver docs do Next sobre
 * instrumentation.ts) — é aqui que ligamos as rotinas de segundo plano do
 * computador da loja, que não dependem de nenhuma tela estar aberta:
 * sincronizar vendas com a nuvem e fazer o backup diário do banco local.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { sincronizarVendas } = await import("./lib/sincronizacao");
  const { fazerBackupDiario } = await import("./lib/backup");

  const SINCRONIZAR_A_CADA_MS = 60 * 1000;
  const BACKUP_A_CADA_MS = 24 * 60 * 60 * 1000;

  setInterval(() => {
    sincronizarVendas().catch((e) => console.error("[sincronizacao] falhou:", e));
  }, SINCRONIZAR_A_CADA_MS);

  // backup logo no boot (cobre o caso do programa ficar dias sem reiniciar
  // antes de pegar o próximo intervalo de 24h) e depois uma vez por dia
  fazerBackupDiario().catch((e) => console.error("[backup] falhou:", e));
  setInterval(() => {
    fazerBackupDiario().catch((e) => console.error("[backup] falhou:", e));
  }, BACKUP_A_CADA_MS);
}
