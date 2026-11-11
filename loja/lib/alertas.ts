import type { Prisma } from "@prisma/client";
import { readFile, stat } from "fs/promises";
import { lerConfig, NUVEM_URL } from "./config";
import { enviarAlertaNuvem } from "./nuvem";
import { prisma } from "./prisma";

export type TipoAlerta = "ESTOQUE_MINIMO" | "DIVERGENCIA" | "SAIDA_SEM_PAGAR" | "INVASAO";

/** Limites do que vai junto pro celular do dono: poucas imagens e pequenas
 *  (quem grava as imagens — visao/ — já deve salvar um JPEG reduzido). */
const MAX_IMAGENS = 3;
const MAX_BYTES_IMAGEM = 400 * 1024;
const LOTE = 20;

/**
 * Põe um aviso pro dono na fila. Só grava localmente — quem manda pra nuvem
 * é enviarAlertasPendentes(), em segundo plano; sem internet, fica aqui até
 * a conexão voltar. Passe o `tx` pra gravar junto com o que causou o aviso.
 */
export function criarAlerta(
  db: Prisma.TransactionClient | typeof prisma,
  alerta: { tipo: TipoAlerta; titulo: string; detalhe: string; imagens?: string[]; ocorridoEm?: Date }
) {
  return db.alertaNuvem.create({
    data: {
      tipo: alerta.tipo, titulo: alerta.titulo, detalhe: alerta.detalhe,
      imagens: JSON.stringify((alerta.imagens ?? []).slice(0, MAX_IMAGENS)),
      ocorridoEm: alerta.ocorridoEm ?? new Date(),
    },
  });
}

export function lerLista(json: string): string[] {
  try {
    const lista: unknown = JSON.parse(json);
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function imagemBase64(caminho: string): Promise<string | null> {
  try {
    if ((await stat(caminho)).size > MAX_BYTES_IMAGEM) return null;
    return (await readFile(caminho)).toString("base64");
  } catch {
    return null; // arquivo já apagado: o aviso vai sem a imagem
  }
}

/** Manda pra nuvem os avisos que ainda não foram. Para no primeiro que
 *  falhar (sem internet) e tenta de novo na próxima rodada. */
export async function enviarAlertasPendentes(): Promise<{ enviados: number }> {
  const deviceKey = await lerConfig("deviceKey");
  if (!deviceKey) return { enviados: 0 };

  const pendentes = await prisma.alertaNuvem.findMany({ where: { enviadoEm: null }, orderBy: { ocorridoEm: "asc" }, take: LOTE });
  let enviados = 0;
  for (const a of pendentes) {
    const imagens = (await Promise.all(lerLista(a.imagens).map(imagemBase64))).filter((i): i is string => i !== null);
    const ok = await enviarAlertaNuvem(NUVEM_URL, deviceKey, {
      codigo: a.codigo, tipo: a.tipo, titulo: a.titulo, detalhe: a.detalhe, imagens, ocorridoEm: a.ocorridoEm.toISOString(),
    });
    if (!ok) break;
    await prisma.alertaNuvem.update({ where: { codigo: a.codigo }, data: { enviadoEm: new Date() } });
    enviados++;
  }
  return { enviados };
}
