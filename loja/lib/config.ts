import { prisma } from "./prisma";

/** Chaves guardadas na tabela Config. */
export type ChaveConfig =
  | "deviceKey" // identidade deste computador (gerada aqui, nunca digitada)
  | "lojaId" // loja vinculada na nuvem — existe = primeiro uso concluído
  | "lojaNome"
  | "lojaCidade"
  | "lojaRua"
  | "lojaCapacidade"
  | "segredoSessao"; // assina o cookie de sessão da gestão

export async function lerConfig(chave: ChaveConfig): Promise<string | null> {
  return (await prisma.config.findUnique({ where: { chave } }))?.valor ?? null;
}

export async function gravarConfig(valores: Partial<Record<ChaveConfig, string>>): Promise<void> {
  await prisma.$transaction(
    Object.entries(valores).map(([chave, valor]) =>
      prisma.config.upsert({ where: { chave }, update: { valor }, create: { chave, valor } })
    )
  );
}

/** Endereço do servidor na nuvem: NUVEM_URL no loja/.env. Sem ela, usa o
 *  servidor local de desenvolvimento; na loja de verdade é o de produção. */
export const NUVEM_URL = process.env.NUVEM_URL ?? "http://localhost:3000";

/** Senha de fábrica do auto-cadastro (o PROVISION_SECRET da nuvem), em
 *  SENHA_FABRICA no loja/.env — vem na instalação, como a que vai gravada
 *  no firmware das máquinas; ninguém digita na tela. */
export const SENHA_FABRICA = process.env.SENHA_FABRICA ?? "";

export type Loja = { id: string; nome: string; cidade: string; rua: string; capacidade: number };

/** A loja deste computador, ou null se o primeiro uso ainda não foi feito. */
export async function lojaConfigurada(): Promise<Loja | null> {
  const linhas = await prisma.config.findMany({
    where: { chave: { in: ["lojaId", "lojaNome", "lojaCidade", "lojaRua", "lojaCapacidade"] } },
  });
  const c = Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
  if (!c.lojaId) return null;
  return {
    id: c.lojaId, nome: c.lojaNome ?? "", cidade: c.lojaCidade ?? "", rua: c.lojaRua ?? "",
    capacidade: Number(c.lojaCapacidade ?? 3),
  };
}
