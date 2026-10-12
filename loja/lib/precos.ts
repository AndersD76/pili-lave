import type { Prisma } from "@prisma/client";
import { registrarAtividade } from "./atividade";
import { reais } from "./dinheiro";
import type { UsuarioGestao } from "./permissoes";

/* Preço de venda pelo PERCENTUAL do produto: preço = custo + X%. É a regra
 * padrão — cada produto guarda o seu percentual (Produto.margemPct) e o
 * preço acompanha o custo sozinho. A exceção é o produto com preço manual
 * (Produto.precoManual), que o lojista fixou e não é reajustado. */

/** Preço a partir do custo e do percentual, arredondado pro centavo. */
export function precoPelaMargem(custoCents: number, margemPct: number): number {
  return Math.round(custoCents * (1 + margemPct / 100));
}

/** "30", "30%", "12,5" → 30 / 30 / 12.5. `null` se vazio, "INVALIDO" se
 *  não for um percentual entre 0 e 1000. */
export function lerPercentual(v: FormDataEntryValue | null): number | null | "INVALIDO" {
  const texto = String(v ?? "").replace(/[%\s]/g, "").replace(",", ".");
  if (!texto) return null;
  const n = Number(texto);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : "INVALIDO";
}

/** "30%" / "12,5%" pra mostrar. */
export function formatarPercentual(pct: number): string {
  return `${String(Math.round(pct * 100) / 100).replace(".", ",")}%`;
}

/**
 * Reajuste automático: recalcula o preço do produto pelo percentual dele e
 * grava se mudou. Chamar SEMPRE que o custo ou o percentual mudar, dentro
 * da mesma transação. Não faz nada em produto com preço manual ou sem
 * percentual. Devolve o preço novo quando houve mudança.
 */
export async function reajustarPreco(
  tx: Prisma.TransactionClient,
  usuario: Pick<UsuarioGestao, "id" | "nome">,
  produtoId: string,
  motivo: string
): Promise<number | null> {
  const p = await tx.produto.findUniqueOrThrow({ where: { id: produtoId } });
  if (p.precoManual || p.margemPct === null) return null;
  const novo = precoPelaMargem(p.custoCents, p.margemPct);
  if (novo === p.precoCents) return null;
  await tx.produto.update({ where: { id: produtoId }, data: { precoCents: novo } });
  await registrarAtividade(
    tx, usuario, "PRECO_ALTERADO",
    `${p.nome}: ${p.precoCents === null ? "sem preço" : reais(p.precoCents)} → ${reais(novo)} — reajuste automático (custo ${reais(p.custoCents)} + ${formatarPercentual(p.margemPct)}; ${motivo})`,
    produtoId
  );
  return novo;
}
