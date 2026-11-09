import { lerConfig, NUVEM_URL } from "./config";
import { sincronizarVendasNuvem } from "./nuvem";
import { prisma } from "./prisma";

/** No máximo isso por chamada — bate com o limite aceito pela rota na
 *  nuvem (ver server/app/api/loja/vendas/sincronizar). */
const LOTE = 50;

/**
 * Manda pra nuvem as vendas que ainda não foram sincronizadas — fica
 * acumulando sozinho enquanto não há internet (ver `Venda.sincronizadaEm`)
 * e um loop em segundo plano (instrumentation.ts) chama isto de tempos em
 * tempos. Sem internet ou sem loja cadastrada, não faz nada: não é erro,
 * só significa que a fila cresce até a conexão voltar.
 */
export async function sincronizarVendas(): Promise<{ enviadas: number }> {
  const deviceKey = await lerConfig("deviceKey");
  if (!deviceKey) return { enviadas: 0 };

  // vendas canceladas antes de sincronizar nunca vão — se cancelar depois
  // de já ter ido, a cópia na nuvem fica (sem efeito hoje: não alimenta
  // nenhum indicador ainda; revisitar quando a etapa 7 existir)
  const pendentes = await prisma.venda.findMany({
    where: { sincronizadaEm: null, canceladaEm: null }, take: LOTE, orderBy: { id: "asc" }, include: { itens: true },
  });
  if (pendentes.length === 0) return { enviadas: 0 };

  const sincronizados = await sincronizarVendasNuvem(
    NUVEM_URL, deviceKey,
    pendentes.map((v) => ({
      codigo: v.codigo, totalCents: v.totalCents, forma: v.forma, criadaEm: v.criadaEm.toISOString(),
      itens: v.itens.map((i) => ({ nome: i.nome, ean: i.ean, quantidade: i.quantidade, precoUnitCents: i.precoUnitCents })),
    }))
  );
  if (sincronizados.length === 0) return { enviadas: 0 };

  await prisma.venda.updateMany({ where: { codigo: { in: sincronizados } }, data: { sincronizadaEm: new Date() } });
  return { enviadas: sincronizados.length };
}
