/**
 * Reinícios das placas da máquina (W1 = controladora, W2 = entradas/saídas remotas).
 *
 * A W1 guarda cada reinício na memória dela e manda para a nuvem quando há internet
 * (evento tipo 4 → display → câmera → POST /api/machine/reset-log). O texto "info" é compacto:
 *   "W1;m=6;e=5;u=1234;n=12;c=1;s=0"
 *   m = esp_reset_reason, e = estado da máquina ANTES do reset (255 = desconhecido), u = segundos ligada antes,
 *   n = total de reinícios daquela placa, c = 1 se estava em ciclo (carro presente), s = restart deliberado (1 memória, 2 rádio),
 *   t = hora do reset (epoch s, UTC; só quando a máquina já tinha o relógio, que vem da internet via câmera).
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
  /** Hora do reset (epoch s, UTC) segundo o relógio da máquina; null = máquina sem relógio na hora. */
  quandoEpoch: number | null;
  /** Ciclo em andamento SEGUNDO o checkpoint da NVS (a máquina perdeu a energia; estado exato desconhecido). */
  cicloNvs: boolean;
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
    quandoEpoch: campos.t !== undefined && campos.t > 1_700_000_000 ? campos.t : null,
    cicloNvs: campos.k === 1,
  };
}

/** Texto curto da causa, para o aviso no celular do lavador. */
export function causaDoReset(r: ResetInfo): string {
  if (r.deliberado === 1) return "reiniciada de propósito (memória baixa)";
  if (r.deliberado === 2) return "reiniciada de propósito (rádio travado)";
  return r.motivoNome;
}

// ---------------------------------------------------------------------------------------------------------------------------
// FASE 0 DA RETOMADA (2026-11-02): retrato da etapa ("J;...") e ocorrências observadas ("O;..."). Só registro: não cancela nem avisa.
// ---------------------------------------------------------------------------------------------------------------------------

export const NOMES_PROCESSO: Record<number, string> = {
  0: "nenhum", 1: "pré-lavagem", 3: "espuma A", 4: "espuma B", 5: "cor mágica", 6: "cera de água", 7: "alta pressão", 8: "secagem", 9: "enxágue", 10: "fim",
};

/** bit 0..7 = X0..X7 (W1); bit 8..15 = X10..X17 (W2). */
export const NOMES_ENTRADAS = ["X0", "X1", "X2", "X3", "X4", "X5", "X6", "X7", "X10", "X11", "X12", "X13", "X14", "X15", "X16", "X17"];

export const NOMES_OCORRENCIA: Record<number, string> = {
  1: "X10 apagou sem 3 s de deslocamento",
  2: "X13 com X10 ativo",
  3: "X12 e X13 juntos",
  4: "X15 sem carro durante o ciclo",
  5: "X10 apagou durante o giro",
};

/** d: 0 giro A (anti-horário) rumo à posição 2, 1 A rumo à 1, 2 B (horário) rumo à 2, 3 B rumo à 1, 4 sem giro. */
export const GIRO_DESC: Record<number, string> = {
  0: "giro A (anti-horário) rumo à posição 2",
  1: "giro A (anti-horário) rumo à posição 1",
  2: "giro B (horário) rumo à posição 2",
  3: "giro B (horário) rumo à posição 1",
  4: "",
};

export type EtapaInfo = {
  proc: number; procNome: string; sub: number; slot: number; giro: number; giroCod: number; giroDesc: string; modelo: number;
  entradas: number; saidas: number; entradasAtivas: string[]; hz10: number; dx14: number | null; dx15: number | null;
};

function camposDe(info: string): Record<string, number> {
  const campos: Record<string, number> = {};
  for (const p of info.split(";").slice(1).map((v) => v.trim())) {
    const m = /^([a-z])=([0-9a-f]{1,10})$/.exec(p);
    if (!m) continue;
    // x e y vêm em hexadecimal; os demais em decimal
    campos[m[1]] = m[1] === "x" || m[1] === "y" ? parseInt(m[2], 16) : /^\d+$/.test(m[2]) ? Number(m[2]) : NaN;
  }
  return campos;
}

/** "J;p=7;q=12;i=3;g=2;d=1;m=4;x=a5f0;y=03c0;h=150;a=1;b=0" */
export function interpretarEtapa(info: string): EtapaInfo | null {
  if (!info.startsWith("J;")) return null;
  const c = camposDe(info);
  if (c.p === undefined || Number.isNaN(c.p)) return null;
  const x = c.x ?? 0;
  const dx = (v: number | undefined) => (v === undefined || v === 255 ? null : v);
  return {
    proc: c.p, procNome: NOMES_PROCESSO[c.p] ?? `processo ${c.p}`, sub: c.q ?? 0, slot: c.i ?? 0, giro: c.g ?? 0, giroCod: c.d ?? 4,
    giroDesc: GIRO_DESC[c.d ?? 4] ?? "", modelo: c.m ?? 0, entradas: x, saidas: c.y ?? 0,
    entradasAtivas: NOMES_ENTRADAS.filter((_, i) => ((x >> i) & 1) === 1), hz10: c.h ?? 0, dx14: dx(c.a), dx15: dx(c.b),
  };
}

export type OcorrenciaInfo = { tipo: number; tipoNome: string; estado: number | null; estadoNome: string | null; total: number | null; valor: number | null; quandoEpoch: number | null };

/** "O;o=1;e=5;n=3;v=1200;t=1798800000" */
export function interpretarOcorrencia(info: string): OcorrenciaInfo | null {
  if (!info.startsWith("O;")) return null;
  const c = camposDe(info);
  if (c.o === undefined || Number.isNaN(c.o)) return null;
  const estado = c.e !== undefined && c.e !== 255 ? c.e : null;
  return {
    tipo: c.o, tipoNome: NOMES_OCORRENCIA[c.o] ?? `ocorrência ${c.o}`, estado, estadoNome: estado === null ? null : ESTADOS_AUTO[estado] ?? `estado ${estado}`,
    total: c.n ?? null, valor: c.v ?? null, quandoEpoch: c.t !== undefined && c.t > 1_700_000_000 ? c.t : null,
  };
}

/** Hora (epoch s) plausível: não no futuro (+5 min de folga) e não mais velha que 7 dias. */
export function horaPlausivel(epoch: number | null): Date | null {
  if (epoch === null) return null;
  const ms = epoch * 1000, agora = Date.now();
  return ms <= agora + 5 * 60_000 && agora - ms <= 7 * 86_400_000 ? new Date(ms) : null;
}
