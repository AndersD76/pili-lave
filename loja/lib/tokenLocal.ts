import { randomBytes, timingSafeEqual } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { gravarConfig, lerConfig } from "./config";

/* Senha das rotas LOCAIS que os outros programas deste computador chamam
 * (o adaptador da porta/catraca, as câmeras em visao/, o reconhecimento em
 * rosto/). É gerada aqui, sozinha, e copiada pra dados/token-local.txt — é
 * de lá que os serviços em Python leem. Vai no header `x-loja-token`. */

export const ARQUIVO_TOKEN = path.join(process.cwd(), "dados", "token-local.txt");

let gravadoNestaExecucao = false;

/** O token (criando na primeira vez) — e garante o arquivo no disco. */
export async function obterTokenLocal(): Promise<string> {
  let token = await lerConfig("tokenLocal");
  if (!token) {
    token = randomBytes(32).toString("hex");
    await gravarConfig({ tokenLocal: token });
    gravadoNestaExecucao = false;
  }
  if (!gravadoNestaExecucao) {
    await mkdir(path.dirname(ARQUIVO_TOKEN), { recursive: true });
    await writeFile(ARQUIVO_TOKEN, token, "utf8");
    gravadoNestaExecucao = true;
  }
  return token;
}

/** true se a chamada trouxe o `x-loja-token` certo. */
export async function conferirTokenLocal(req: Request): Promise<boolean> {
  const esperado = Buffer.from(await obterTokenLocal());
  const recebido = Buffer.from(req.headers.get("x-loja-token") ?? "");
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}
