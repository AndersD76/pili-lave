/**
 * Contrato entre o caixa e QUALQUER maquininha de cartão — hoje só existe o
 * driver manual (ver manual.ts), mas o desenho já é o de uma integração de
 * verdade: iniciar() pede a cobrança e devolve na hora, consultar() diz
 * como ela está indo. O caixa (e as rotas em app/api/caixa/cartao/) só
 * conhecem este contrato; trocar de maquininha é trocar o driver importado
 * em index.ts, sem mexer em mais nada.
 *
 * Por que duas chamadas (iniciar + consultar) em vez de uma só que espera
 * terminar: a cobrança pode levar bastante tempo (cliente procurando o
 * cartão, aproximando, digitando a senha), e um SDK real normalmente
 * trabalha por eventos ou por consulta periódica, não com uma chamada só
 * que fica presa esperando. O caixa consulta a cada poucos segundos até
 * sair de AGUARDANDO.
 */
export type ResultadoCobranca =
  | { situacao: "AGUARDANDO" }
  | { situacao: "APROVADO"; referencia?: string }
  | { situacao: "RECUSADO"; motivo: string };

export interface Maquininha {
  /** Nome pra mostrar na tela do caixa e nos registros ("Stone", "Cielo"…). */
  nome: string;
  /** true só no driver manual: aí o caixa mostra os botões de confirmar/
   *  recusar na tela, porque não tem máquina de verdade respondendo
   *  sozinha. Uma integração de verdade deixa isto false. */
  confirmacaoManual: boolean;
  /** Pede a cobrança. Devolve um id pra acompanhar com consultar(). */
  iniciar(totalCents: number): Promise<{ operacaoId: string }>;
  /** Como está indo uma cobrança já iniciada. */
  consultar(operacaoId: string): Promise<ResultadoCobranca>;
}
