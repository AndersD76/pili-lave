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

  // venda cancelada ANTES de sincronizar nunca vai; cancelada DEPOIS, a
  // nuvem é avisada pra tirar dos indicadores
  const [pendentes, canceladas] = await Promise.all([
    prisma.venda.findMany({
      where: { sincronizadaEm: null, canceladaEm: null }, take: LOTE, orderBy: { id: "asc" }, include: { itens: true },
    }),
    prisma.venda.findMany({
      where: { sincronizadaEm: { not: null }, canceladaEm: { not: null }, cancelamentoSincronizadoEm: null },
      take: LOTE, orderBy: { id: "asc" }, select: { codigo: true, canceladaEm: true },
    }),
  ]);
  if (pendentes.length === 0 && canceladas.length === 0) return { enviadas: 0 };

  const { sincronizados, cancelados } = await sincronizarVendasNuvem(
    NUVEM_URL, deviceKey,
    pendentes.map((v) => ({
      codigo: v.codigo, totalCents: v.totalCents, forma: v.forma, criadaEm: v.criadaEm.toISOString(),
      itens: v.itens.map((i) => ({ nome: i.nome, ean: i.ean, quantidade: i.quantidade, precoUnitCents: i.precoUnitCents })),
    })),
    canceladas.map((v) => ({ codigo: v.codigo, canceladaEm: v.canceladaEm!.toISOString() }))
  );

  const agora = new Date();
  if (sincronizados.length > 0)
    await prisma.venda.updateMany({ where: { codigo: { in: sincronizados } }, data: { sincronizadaEm: agora } });
  if (cancelados.length > 0)
    await prisma.venda.updateMany({ where: { codigo: { in: cancelados } }, data: { cancelamentoSincronizadoEm: agora } });
  return { enviadas: sincronizados.length };
}
