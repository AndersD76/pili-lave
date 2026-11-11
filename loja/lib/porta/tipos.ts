/**
 * Contrato entre o programa da loja e QUALQUER equipamento que abre a porta
 * (catraca Control iD, trava no ESP32 por BLE…) — mesmo molde de
 * lib/maquininha/. Hoje só existe o driver simulado (ver simulado.ts);
 * quando o equipamento for escolhido, escreve-se o driver dele e troca-se a
 * linha em index.ts, sem mexer nas telas nem nas rotas.
 *
 * A ENTRADA normal do cliente não passa por aqui: quem pede é o próprio
 * equipamento, pela rota /api/entrada/autorizar, e ele mesmo libera ao
 * receber "liberado". Este contrato é pra quando a loja manda abrir:
 * abertura remota do lojista pelo app e o botão da gestão.
 */
export type ResultadoPorta = { ok: true } | { ok: false; erro: string };

export interface Porta {
  /** Nome pra mostrar na gestão e nos registros. */
  nome: string;
  /** Libera uma passagem. `motivo` é só pra registro. */
  abrir(motivo: string): Promise<ResultadoPorta>;
}
