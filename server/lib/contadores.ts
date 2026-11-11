import { prisma } from "./prisma";
import { alertarAdmin, resolverAlerta } from "./saude";
import { precoEfetivo } from "./precos";

/**
 * CONFERÊNCIA DOS CONTADORES: o display da máquina conta as lavagens por modelo (Presencial, Aplicativo, Sócios, Bônus) desde o último
 * "acerto" e é considerado a VERDADE (decisão do Giovani, 2026-11-04). A cada ~15 min (e depois de cada ciclo) ele manda esses números à
 * nuvem em 2 relatórios compactos (evento tipo 4 do display, info "C;..."): parte 1 = presencial + app, parte 2 = sócios + bônus.
 * A nuvem conta o que tem no banco desde a mesma data e, se for diferente em DOIS relatórios seguidos (não pega ciclo em trânsito),
 * avisa o admin (alerta persistente CONTADORES_DIVERGENTES, uma vez ao divergir e uma ao normalizar). Só avisa: não corrige nada.
 */
export type GruposContadores = { p?: number[]; a?: number[]; s?: number[]; b?: number[] };
export type RelatorioContadores = { parte: 1 | 2; desde: Date | null; desdeTxt: string; grupos: GruposContadores };

const NOME_GRUPO: Record<string, string> = { p: "Presencial", a: "App", s: "Sócios", b: "Bônus" };

/** "C;1;d=2.11.2026;p=5.22.4.4;a=6.6.1.0" → relatório. d=0.0.0 = o display nunca teve acerto (conta desde o começo). */
export function interpretarContadores(info: string): RelatorioContadores | null {
  const partes = info.split(";");
  if (partes[0] !== "C" || (partes[1] !== "1" && partes[1] !== "2")) return null;
  let desde: Date | null = null;
  let desdeTxt = "o começo";
  const grupos: GruposContadores = {};
  for (const x of partes.slice(2)) {
    const [k, v] = x.split("=");
    if (!k || v === undefined) continue;
    if (k === "d") {
      const [d, m, a] = v.split(".").map(Number);
      if (d >= 1 && m >= 1 && m <= 12 && a >= 2020 && a < 2100) {
        desde = new Date(Date.UTC(a, m - 1, d, 3, 0, 0)); // meia-noite de Brasília
        desdeTxt = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${a}`;
      }
    } else if (k === "p" || k === "a" || k === "s" || k === "b") {
      const nums = v.split(".").map(Number);
      if (nums.length === 4 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 65535)) grupos[k] = nums;
    }
  }
  if (!Object.keys(grupos).length) return null;
  return { parte: partes[1] === "1" ? 1 : 2, desde, desdeTxt, grupos };
}

/** O que a nuvem tem desde `desde`, por modelo (1..4): presencial puro, app, sócios e bônus. */
export async function contagemDaNuvem(machineId: string, desde: Date | null, desdeTxt = "o começo") {
  const ini = desde ?? new Date(0);
  const [app, pres, tipos, ajustes] = await Promise.all([
    prisma.reservation.groupBy({ by: ["programId"], where: { machineId, status: "COMPLETED", completedAt: { gte: ini } }, _count: { _all: true } }),
    prisma.lavagemPresencial.groupBy({ by: ["programId"], where: { machineId, completedAt: { gte: ini } }, _count: { _all: true } }),
    prisma.event.findMany({
      where: { type: "lavagem_tipo", createdAt: { gte: ini }, payload: { path: ["machineId"], equals: machineId } },
      select: { payload: true },
    }),
    // ajustes que o admin decidiu no acerto (contadores_ajuste): diferença já conhecida e aceita entre o display e a nuvem
    prisma.event.findMany({
      where: { type: "contadores_ajuste", payload: { path: ["machineId"], equals: machineId } },
      select: { payload: true },
    }),
  ]);
  const vazio = () => [0, 0, 0, 0];
  const r = { p: vazio(), a: vazio(), s: vazio(), b: vazio() };
  for (const g of app) if (g.programId >= 1 && g.programId <= 4) r.a[g.programId - 1] = g._count._all;
  for (const g of pres) if (g.programId >= 1 && g.programId <= 4) r.p[g.programId - 1] = g._count._all;
  for (const e of tipos) {
    const p = (e.payload ?? {}) as { programId?: number; tipo?: string };
    if (!p.programId || p.programId < 1 || p.programId > 4) continue;
    if (p.tipo === "SOCIO") r.s[p.programId - 1]++;
    if (p.tipo === "BONUS") r.b[p.programId - 1]++;
  }
  for (let i = 0; i < 4; i++) r.p[i] = Math.max(0, r.p[i] - r.s[i] - r.b[i]); // sócio e bônus também ficam em LavagemPresencial
  for (const e of ajustes) {
    const a = (e.payload ?? {}) as { desde?: string; g?: string; modelo?: number; delta?: number };
    if (a.desde !== desdeTxt || !a.g || !(a.g in r) || !a.modelo || a.modelo < 1 || a.modelo > 4 || typeof a.delta !== "number") continue;
    (r as Record<string, number[]>)[a.g][a.modelo - 1] += a.delta;
  }
  return r;
}

export type Divergencia = { grupo: string; g: "p" | "a" | "s" | "b"; modelo: number; display: number; nuvem: number };

export async function compararContadores(machineId: string, rel: RelatorioContadores): Promise<Divergencia[]> {
  const nuvem = await contagemDaNuvem(machineId, rel.desde, rel.desdeTxt);
  const out: Divergencia[] = [];
  for (const k of ["p", "a", "s", "b"] as const) {
    const d = rel.grupos[k];
    if (!d) continue;
    for (let i = 0; i < 4; i++) if (d[i] !== nuvem[k][i]) out.push({ grupo: NOME_GRUPO[k], g: k, modelo: i + 1, display: d[i], nuvem: nuvem[k][i] });
  }
  return out;
}

async function ultimaAvaliacao(machineId: string, parte: string): Promise<boolean | null> {
  const e = await prisma.event.findFirst({
    where: { type: "contadores_aval", AND: [{ payload: { path: ["machineId"], equals: machineId } }, { payload: { path: ["parte"], equals: parte } }] },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  if (!e) return null;
  return (e.payload as { divergente?: boolean } | null)?.divergente === true;
}

/**
 * Chamada a cada relatório. Compara com a nuvem e decide: 1ª divergência = só anota; 2ª seguida = alerta o admin; bateu = normaliza.
 * O estado (divergente sim/não, por parte) fica em Events "contadores_aval", sem tabela nova.
 */
export async function registrarContadores(
  machine: { id: string; operadorId: string | null; name: string },
  rel: RelatorioContadores
): Promise<void> {
  const div = await compararContadores(machine.id, rel);
  await prisma.event.create({
    data: {
      type: "contadores_display",
      payload: { machineId: machine.id, parte: rel.parte, desde: rel.desdeTxt, desdeIso: rel.desde ? rel.desde.toISOString() : null, grupos: rel.grupos, divergencias: div.length } as object,
    },
  });

  const chave = `parte${rel.parte}`;
  const antes = await ultimaAvaliacao(machine.id, chave);
  const divergente = div.length > 0;
  if (antes === null || divergente !== antes)
    await prisma.event.create({ data: { type: "contadores_aval", payload: { machineId: machine.id, parte: chave, divergente } as object } });

  // o alerta é UM só por máquina: abre na 2ª divergência seguida de qualquer parte e fecha quando as duas partes batem
  if (divergente && antes === true) {
    const resumo = div.slice(0, 6).map((x) => `${x.grupo} modelo ${x.modelo}: display ${x.display} × nuvem ${x.nuvem}`).join("; ");
    const msg = `Contadores de lavagem diferentes entre o display e a nuvem (desde ${rel.desdeTxt}) em ${machine.name}: ${resumo}${div.length > 6 ? ` … (+${div.length - 6})` : ""}. O display é a referência. Resolva em Admin > Lavagens (escolher qual lista usar).`;
    await alertarAdmin("CONTADORES_DIVERGENTES", msg, div, machine.id, machine.operadorId, true);
  } else if (!divergente) {
    const outra = await ultimaAvaliacao(machine.id, rel.parte === 1 ? "parte2" : "parte1");
    if (outra !== true)
      await resolverAlerta("CONTADORES_DIVERGENTES", "Os contadores do display e da nuvem voltaram a bater.", machine.id, machine.operadorId);
  }
}

/** Últimos relatórios do display (um por parte, até 36 h) já convertidos para comparar. */
async function relatoriosRecentes(machineId: string): Promise<RelatorioContadores[]> {
  const evs = await prisma.event.findMany({
    where: { type: "contadores_display", createdAt: { gte: new Date(Date.now() - 36 * 3600_000) }, payload: { path: ["machineId"], equals: machineId } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { payload: true },
  });
  const porParte = new Map<number, RelatorioContadores>();
  for (const e of evs) {
    const p = (e.payload ?? {}) as { parte?: number; desde?: string; desdeIso?: string | null; grupos?: GruposContadores };
    if ((p.parte !== 1 && p.parte !== 2) || porParte.has(p.parte) || !p.grupos) continue;
    porParte.set(p.parte, { parte: p.parte, desde: p.desdeIso ? new Date(p.desdeIso) : null, desdeTxt: p.desde ?? "o começo", grupos: p.grupos });
  }
  return [...porParte.values()];
}

/** Divergências ATUAIS (display x nuvem) da máquina, com os relatórios mais recentes. */
export async function divergenciasAtuais(machineId: string): Promise<{ desdeTxt: string; itens: Divergencia[] } | null> {
  const rels = await relatoriosRecentes(machineId);
  if (!rels.length) return null;
  const itens: Divergencia[] = [];
  for (const r of rels) itens.push(...(await compararContadores(machineId, r)));
  return itens.length ? { desdeTxt: rels[0].desdeTxt, itens } : null;
}

/**
 * ACERTO — o admin escolhe qual lista vale quando o display e a nuvem diferem:
 *  - "display": a nuvem passa a refletir o display. O que o display tem a MAIS em presencial / sócios / bônus vira lavagem registrada agora
 *    (presencial com o preço vigente da unidade — é dinheiro que entrou na máquina e a nuvem nunca soube; sócio e bônus com valor 0), para
 *    entrar nos números do fechamento. Qualquer outra diferença (app, ou a nuvem ter MAIS que o display) não cria nem apaga nada: vira um
 *    ajuste registrado (Event contadores_ajuste) e a conferência passa a considerá-la aceita.
 *  - "nuvem": a nuvem está certa; o display segue com os números dele até o próximo acerto na máquina (que zera o contador). Todas as
 *    diferenças viram ajustes aceitos e o alerta é encerrado.
 * Nada é apagado. Tudo fica registrado (Event contadores_escolha) com quem escolheu.
 */
export async function resolverContadores(machineId: string, fonte: "display" | "nuvem", adminId: string | null): Promise<number> {
  const atual = await divergenciasAtuais(machineId);
  if (!atual) return 0;
  const machine = await prisma.machine.findUnique({ where: { id: machineId }, select: { id: true, stationId: true, operadorId: true, name: true } });
  if (!machine) return 0;
  let criadas = 0;
  for (const d of atual.itens) {
    const delta = d.display - d.nuvem;
    let ajuste = delta;
    if (fonte === "display" && delta > 0 && (d.g === "p" || d.g === "s" || d.g === "b")) {
      const valor = d.g === "p" ? await precoEfetivo(d.modelo, machine.stationId) : 0;
      for (let k = 0; k < delta; k++) {
        const lav = await prisma.lavagemPresencial.create({ data: { machineId, programId: d.modelo, amountCents: valor } });
        if (d.g !== "p")
          await prisma.event.create({
            data: { type: "lavagem_tipo", payload: { lavagemId: lav.id, machineId, programId: d.modelo, tipo: d.g === "s" ? "SOCIO" : "BONUS", origem: "acerto" } },
          });
        criadas++;
      }
      ajuste = 0;   // já virou lavagem registrada: a contagem da nuvem bate sem ajuste
    }
    if (ajuste !== 0)
      await prisma.event.create({
        data: { type: "contadores_ajuste", payload: { machineId, desde: atual.desdeTxt, g: d.g, modelo: d.modelo, delta: ajuste, fonte } },
      });
  }
  await prisma.event.create({
    data: { type: "contadores_escolha", payload: { machineId, fonte, lavagensCriadas: criadas, divergencias: atual.itens, adminId } as object },
  });
  await resolverAlerta("CONTADORES_DIVERGENTES",
    fonte === "display" ? "O admin escolheu a lista do display e a nuvem foi ajustada." : "O admin escolheu manter a lista da nuvem.",
    machineId, machine.operadorId);
  return criadas;
}
