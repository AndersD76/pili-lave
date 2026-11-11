import { portaSimulada } from "./simulado";
import type { Porta } from "./tipos";

/** Driver ativo. Trocar aqui quando a catraca ou a trava de verdade chegar. */
export const porta: Porta = portaSimulada;

export type { Porta, ResultadoPorta } from "./tipos";
