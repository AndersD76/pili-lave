import { registrarAtividade } from "./atividade";
import { lerConfig, NUVEM_URL } from "./config";
import { reais } from "./dinheiro";
import { movimentar } from "./estoque";
import { estornarCarteira } from "./nuvem";
import type { UsuarioGestao } from "./permissoes";
import { prisma } from "./prisma";

export type ResultadoCancelamento = { ok: true } | { ok: false; erro: string };

/**
 * Desfaz uma venda: devolve a quantidade de cada item ao estoque e, se foi
 * paga pela carteira do app, devolve o dinheiro ao cliente na nuvem.
 *
 * O estorno na carteira é feito ANTES de qualquer mudança local — se a
 * nuvem recusar ou estiver fora do ar, a venda continua valendo e nada
 * muda aqui (sem internet, cancelar venda pago pela carteira tem que
 * esperar). `estornarCarteira` já é idempotente pelo código da venda, então
 * tentar de novo depois nunca devolve o dinheiro duas vezes.
 */
export async function cancelarVenda(usuario: UsuarioGestao, vendaId: number, motivo: string): Promise<ResultadoCancelamento> {
  const motivoLimpo = motivo.trim();
  if (!motivoLimpo) return { ok: false, erro: "Informe o motivo do cancelamento." };

  const venda = await prisma.venda.findUnique({ where: { id: vendaId }, include: { itens: true } });
  if (!venda) return { ok: false, erro: "Venda não encontrada." };
  if (venda.canceladaEm) return { ok: false, erro: "Essa venda já está cancelada." };

  if (venda.forma === "CARTEIRA") {
    const deviceKey = await lerConfig("deviceKey");
    if (!deviceKey) return { ok: false, erro: "Loja não cadastrada — não dá pra estornar." };
    const estornado = await estornarCarteira(NUVEM_URL, deviceKey, venda.codigo);
    if (!estornado)
      return { ok: false, erro: "Não foi possível devolver o valor na carteira do cliente (sem internet ou a nuvem recusou). Tente de novo quando a conexão voltar." };
  }

  await prisma.$transaction(async (tx) => {
    for (const item of venda.itens)
      await movimentar(tx, {
        produtoId: item.produtoId, tipo: "AJUSTE", quantidade: item.quantidade,
        nota: `Cancelamento da venda nº ${venda.id}`, refId: venda.codigo, usuarioId: usuario.id,
      });
    await tx.venda.update({ where: { id: venda.id }, data: { canceladaEm: new Date(), motivoCancelamento: motivoLimpo } });
    await registrarAtividade(tx, usuario, "VENDA_CANCELADA", `Venda nº ${venda.id} (${reais(venda.totalCents)}) — ${motivoLimpo}`);
  });

  return { ok: true };
}
