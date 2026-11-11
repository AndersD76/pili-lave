/**
 * Roda uma vez quando o servidor Next.js sobe (ver docs do Next sobre
 * instrumentation.ts) — é aqui que ligamos as rotinas de segundo plano do
 * computador da loja, que não dependem de nenhuma tela estar aberta:
 * sincronizar vendas com a nuvem, fazer o backup diário do banco local,
 * buscar clientes e ordens do dono, mandar avisos e fechar a auditoria.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { sincronizarVendas } = await import("./lib/sincronizacao");
  const { fazerBackupDiario } = await import("./lib/backup");

  const { enviarAlertasPendentes } = await import("./lib/alertas");
  const { sincronizarComandos, sincronizarRostos } = await import("./lib/sincronizacaoLoja");
  const { obterTokenLocal } = await import("./lib/tokenLocal");
  const { fecharPeriodo } = await import("./lib/visao");
  const { expirarVisitas } = await import("./lib/visitas");

  const SINCRONIZAR_A_CADA_MS = 60 * 1000;
  const COMANDOS_A_CADA_MS = 15 * 1000;
  const AUDITORIA_A_CADA_MS = 20 * 1000;

  // garante dados/token-local.txt pros serviços de câmera e reconhecimento
  obterTokenLocal().catch((e) => console.error("[token local] falhou:", e));

  // ordens do dono (bloqueio, abertura remota) e avisos pra ele: rápido,
  // porque alguém pode estar esperando na porta
  let ocupadoComandos = false;
  setInterval(async () => {
    if (ocupadoComandos) return;
    ocupadoComandos = true;
    try {
      await sincronizarComandos();
      await enviarAlertasPendentes();
    } catch (e) {
      console.error("[comandos/alertas] falhou:", e);
    } finally {
      ocupadoComandos = false;
    }
  }, COMANDOS_A_CADA_MS);

  // cópia dos clientes (nome, código e rosto) pra entrada e totem sem internet
  let ocupadoRostos = false;
  setInterval(async () => {
    if (ocupadoRostos) return;
    ocupadoRostos = true;
    try {
      await sincronizarRostos();
    } catch (e) {
      console.error("[rostos] falhou:", e);
    } finally {
      ocupadoRostos = false;
    }
  }, SINCRONIZAR_A_CADA_MS);

  // loja esvaziou: confere o que saiu das prateleiras contra o que foi pago
  setInterval(async () => {
    try {
      await expirarVisitas();
      await fecharPeriodo();
    } catch (e) {
      console.error("[auditoria] falhou:", e);
    }
  }, AUDITORIA_A_CADA_MS);
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
