import type { Porta } from "./tipos";

/** Driver de hoje, sem equipamento nenhum ligado: só escreve no console
 *  que a porta teria aberto. */
export const portaSimulada: Porta = {
  nome: "Porta simulada (sem equipamento)",
  async abrir(motivo) {
    console.log(`[porta] abriria agora — ${motivo}`);
    return { ok: true };
  },
};
