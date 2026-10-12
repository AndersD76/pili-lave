import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { gravarConfig, lerConfig, lojaConfigurada, type Loja } from "./config";

/* Sessão da GESTÃO da loja (estoque, produtos, entradas). O computador fica
 * num container sem funcionário e o totem roda nele: sem senha, qualquer
 * cliente abriria o estoque. Uma senha só, criada no primeiro uso — mesmo
 * esquema do painel admin da nuvem (cookie JWT). */

const COOKIE = "loja_gestao";
const MIN_LEN = 6;

export function validarSenha(senha: string): string | null {
  return senha.length < MIN_LEN ? `A senha precisa ter pelo menos ${MIN_LEN} caracteres.` : null;
}

/** "salt:hash" — scrypt, igual ao server/lib/password.ts. */
export function hashSenha(senha: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(senha, salt, 64).toString("hex")}`;
}

export function conferirSenha(senha: string, guardada: string): boolean {
  const [salt, hash] = guardada.split(":");
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, "hex");
  const teste = scryptSync(senha, salt, 64);
  return teste.length === hashBuf.length && timingSafeEqual(teste, hashBuf);
}

/** Segredo que assina o cookie — gerado aqui na primeira vez, nunca sai do
 *  computador da loja. */
async function segredo(): Promise<Uint8Array> {
  let s = await lerConfig("segredoSessao");
  if (!s) {
    s = randomBytes(32).toString("hex");
    await gravarConfig({ segredoSessao: s });
  }
  return new TextEncoder().encode(s);
}

export async function abrirSessao(): Promise<void> {
  const token = await new SignJWT({ gestao: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(await segredo());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 12 * 3600 });
}

export async function fecharSessao(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function sessaoAberta(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, await segredo());
    return true;
  } catch {
    return false;
  }
}

/**
 * Guarda de TODA página e ação da gestão: sem loja cadastrada vai pro
 * primeiro uso; sem sessão vai pra tela de senha. Devolve a loja.
 */
export async function exigirGestao(): Promise<Loja> {
  const loja = await lojaConfigurada();
  if (!loja) redirect("/primeiro-uso");
  if (!(await sessaoAberta())) redirect("/entrar");
  return loja;
}
