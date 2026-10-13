import type { Prisma } from "@prisma/client";
import type { UsuarioGestao } from "./permissoes";
import { prisma } from "./prisma";

/** Tipos de atividade registrados (campo Atividade.acao). */
export const ROTULO_ACAO: Record<string, string> = {
  ENTROU: "Entrou na gestão",
  PRODUTO_CRIADO: "Cadastrou produto",
  PRODUTO_ALTERADO: "Alterou produto",
  PRECO_ALTERADO: "Alterou preço",
  PERCENTUAL_ALTERADO: "Alterou percentual de venda",
  ENTRADA: "Deu entrada",
  NOTA_ENTRADA: "Deu entrada por nota fiscal",
  PERDA: "Registrou perda",
  LISTA_COMPRAS: "Alterou a lista de compras",
  INVENTARIO: "Contagem de inventário",
  USUARIO_CRIADO: "Cadastrou usuário",
  USUARIO_ALTERADO: "Alterou usuário",
};

/**
 * Grava uma linha no registro de atividades. Toda ação que muda dados na
 * gestão chama isto — de preferência dentro da MESMA transação da mudança
 * (passando o `tx`), pra não existir mudança sem registro nem o contrário.
 */
export function registrarAtividade(
  db: Prisma.TransactionClient | typeof prisma,
  usuario: Pick<UsuarioGestao, "id" | "nome">,
  acao: keyof typeof ROTULO_ACAO,
  detalhe: string,
  produtoId?: string | null
) {
  return db.atividade.create({
    data: { usuarioId: usuario.id, usuarioNome: usuario.nome, acao, detalhe, produtoId: produtoId ?? null },
  });
}
