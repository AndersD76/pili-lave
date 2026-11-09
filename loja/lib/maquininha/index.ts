import { maquininhaManual } from "./manual";
import type { Maquininha } from "./tipos";

/**
 * Driver ativo. Hoje é a confirmação manual (ver manual.ts), porque ainda
 * não escolhemos Stone ou Cielo nem temos o hardware. Quando a maquininha
 * chegar: escrever o driver novo em (por exemplo) stone.ts implementando
 * `Maquininha` (ver tipos.ts) e trocar a linha abaixo — o resto do
 * sistema (rotas em app/api/caixa/cartao/, a tela do caixa) não muda.
 */
export const maquininha: Maquininha = maquininhaManual;

export type { Maquininha, ResultadoCobranca } from "./tipos";
