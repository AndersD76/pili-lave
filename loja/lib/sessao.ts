import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { gravarConfig, lerConfig, lojaConfigurada, type Loja } from "./config";
import { lerPermissoes, pode, rotuloPermissao, type Permissao, type UsuarioGestao } from "./permissoes";
import { prisma } from "./prisma";

/* Sessão da GESTÃO da loja. A tela principal do computador é a do cliente;
 * pra entrar na gestão a pessoa se identifica com usuário e senha, e tudo o
 * que ela fizer fica registrado no nome dela (lib/atividade.ts). */

const COOKIE = "loja_gestao";
const MIN_LEN = 6;
/** A máquina fica na frente dos clientes: a sessão é curta de propósito. */
const DURACAO_MIN = 30;

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

export async function abrirSessao(usuarioId: string): Promise<void> {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(usuarioId)
    .setIssuedAt()
    .setExpirationTime(`${DURACAO_MIN}m`)
    .sign(await segredo());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: DURACAO_MIN * 60 });
}

export async function fecharSessao(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Quem está na gestão agora (ou null). Lê o usuário do banco a cada vez:
 *  desativar alguém ou tirar uma permissão vale na hora, sem esperar a
 *  sessão dele vencer. */
export async function usuarioDaSessao(): Promise<UsuarioGestao | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let id: string | undefined;
  try {
    id = (await jwtVerify(token, await segredo())).payload.sub;
  } catch {
    return null;
  }
  if (!id) return null;
  const u = await prisma.usuario.findUnique({ where: { id } });
  if (!u || !u.ativo) return null;
  return {
    id: u.id, nome: u.nome, login: u.login,
    papel: u.papel === "LOJISTA" ? "LOJISTA" : "FUNCIONARIO",
    permissoes: lerPermissoes(u.permissoes),
  };
}

/**
 * Guarda de TODA página e ação da gestão: sem loja cadastrada vai pro
 * primeiro uso; sem sessão vai pra tela de usuário e senha.
 */
export async function exigirGestao(): Promise<{ loja: Loja; usuario: UsuarioGestao }> {
  const loja = await lojaConfigurada();
  if (!loja) redirect("/primeiro-uso");
  const usuario = await usuarioDaSessao();
  if (!usuario) redirect("/entrar");
  return { loja, usuario };
}

/** Igual ao exigirGestao, e ainda confere a permissão — sem ela, volta pro
 *  painel com o aviso. Toda AÇÃO que muda dados chama esta. */
export async function exigirPermissao(permissao: Permissao): Promise<{ loja: Loja; usuario: UsuarioGestao }> {
  const ctx = await exigirGestao();
  if (!pode(ctx.usuario, permissao))
    redirect(`/gestao?erro=${encodeURIComponent(`Você não tem permissão para: ${rotuloPermissao(permissao).toLowerCase()}.`)}`);
  return ctx;
}

/** Só o lojista: cadastro de usuários e registro de atividades. */
export async function exigirLojista(): Promise<{ loja: Loja; usuario: UsuarioGestao }> {
  const ctx = await exigirGestao();
  if (ctx.usuario.papel !== "LOJISTA")
    redirect(`/gestao?erro=${encodeURIComponent("Só o lojista tem acesso a essa área.")}`);
  return ctx;
}
