import { copyFile, mkdir, readdir, stat, unlink } from "fs/promises";
import path from "path";

/** Onde fica o banco de verdade — mesma pasta usada em todo o resto do
 *  programa (ver DATABASE_URL em .env, que aponta pra este arquivo). */
const BANCO = path.join(process.cwd(), "dados", "loja.db");
const PASTA_BACKUPS = path.join(process.cwd(), "dados", "backups");
/** Backups mais antigos que isso são apagados — um por dia já é mais do
 *  que suficiente pra recuperar de um problema recente. */
const DIAS_PARA_GUARDAR = 30;

function nomeDeHoje(): string {
  const agora = new Date();
  const d = String(agora.getDate()).padStart(2, "0");
  const m = String(agora.getMonth() + 1).padStart(2, "0");
  return `loja-${agora.getFullYear()}-${m}-${d}.db`;
}

/**
 * Copia o banco local pra `dados/backups/`, um arquivo por dia (sobrescreve
 * se já tiver rodado hoje), e apaga os mais antigos que 30 dias. Chamado
 * uma vez por dia pelo loop em instrumentation.ts — não depende de internet
 * nem da nuvem, é só uma cópia no mesmo computador.
 */
export async function fazerBackupDiario(): Promise<void> {
  await mkdir(PASTA_BACKUPS, { recursive: true });
  await copyFile(BANCO, path.join(PASTA_BACKUPS, nomeDeHoje()));

  const limite = Date.now() - DIAS_PARA_GUARDAR * 24 * 60 * 60 * 1000;
  for (const arq of await readdir(PASTA_BACKUPS)) {
    const caminho = path.join(PASTA_BACKUPS, arq);
    const info = await stat(caminho);
    if (info.mtimeMs < limite) await unlink(caminho);
  }
}
