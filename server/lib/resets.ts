/**
 * Reinícios das placas da máquina (W1 = controladora, W2 = entradas/saídas remotas).
 *
 * A W1 guarda cada reinício na memória dela e manda para a nuvem quando há internet
 * (evento tipo 4 → display → câmera → POST /api/machine/reset-log). O texto "info" é compacto:
 *   "W1;m=6;e=5;u=1234;n=12;c=1;s=0"
 *   m = esp_reset_reason, e = estado da máquina ANTES do reset (255 = desconhecido), u = segundos ligada antes,
 *   n = total de reinícios daquela placa, c = 1 se estava em ciclo (carro presente), s = restart deliberado (1 memória, 2 rádio).
 */

export const MOTIVOS_RESET: Record<number, string> = {
  1: "energia ligada",
  2: "botão de reset",
  3: "reinício por software",
  4: "erro interno (panic)",
  5: "travou (watchdog de interrupção)",
  6: "travou (watchdog de tarefa)",
  7: "travou (watchdog)",
  8: "saída do repouso",
  9: "queda de tensão",
  11: "USB (técnico)",
  12: "JTAG (técnico)",
};

export const ESTADOS_AUTO: Record<number, string> = {
  0: "parada",
  1: "aguardando o carro",
  2: "carro entrando",
  3: "aguardando a posição",
  4: "iniciando",
  5: "lavando",
  6: "ciclo concluído",
  7: "em erro",
  8: "pausada",
  9: "fazendo o HOME",
};

export type ResetInfo = {
  quem: "W1" | "W2";
  motivo: number;
  motivoNome: string;
  estado: number | null;
  estadoNome: string | null;
  emCiclo: boolean;
  upAntSeg: number | null;
  total: number | null;
  deliberado: number;
};

/** Lê o texto compacto enviado pela W1. Devolve null se não for reconhecível. */
export function interpretarReset(info: string): ResetInfo | null {
  const partes = info.split(";").map((p) => p.trim());
  const quem = partes[0];
  if (quem !== "W1" && quem !== "W2") return null;
  const campos: Record<string, number> = {};
  for (const p of partes.slice(1)) {
    const m = /^([a-z])=(\d{1,10})$/.exec(p);
    if (m) campos[m[1]] = Number(m[2]);
  }
  if (campos.m === undefined) return null;
  const estado = campos.e !== undefined && campos.e !== 255 ? campos.e : null;
  return {
    quem,
    motivo: campos.m,
    motivoNome: MOTIVOS_RESET[campos.m] ?? `motivo ${campos.m}`,
    estado,
    estadoNome: estado === null ? null : ESTADOS_AUTO[estado] ?? `estado ${estado}`,
    emCiclo: campos.c === 1,
    upAntSeg: campos.u !== undefined && campos.u > 0 ? campos.u : null,
    total: campos.n ?? null,
    deliberado: campos.s ?? 0,
  };
}

/** Texto curto da causa, para o aviso no celular do lavador. */
export function causaDoReset(r: ResetInfo): string {
  if (r.deliberado === 1) return "reiniciada de propósito (memória baixa)";
  if (r.deliberado === 2) return "reiniciada de propósito (rádio travado)";
  return r.motivoNome;
}
