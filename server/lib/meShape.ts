import { prisma } from "@/lib/prisma";
import { TERMOS_VERSAO } from "@/lib/termos";
import type { User, TipoParticipacao, StatusSolicitacao } from "@prisma/client";

export type SolicitacaoResumo = { tipo: TipoParticipacao; status: StatusSolicitacao };

/** Formato comum devolvido em /api/auth/register, /api/auth/login e
 *  /api/me — inclui as solicitações de participação (Lavador/Comissão
 *  1/2/Aluguel) pra o app saber o que já foi pedido/aprovado/rejeitado
 *  sem precisar de outra chamada. */
export async function meComSolicitacoes(user: User) {
  const [solicitacoes, foto] = await Promise.all([
    prisma.solicitacaoParceiro.findMany({
      where: { userId: user.id },
      select: { tipo: true, status: true },
    }) as Promise<SolicitacaoResumo[]>,
    prisma.fotoRosto.findUnique({ where: { userId: user.id }, select: { userId: true } }),
  ]);
  return {
    id: user.id, phone: user.phone, email: user.email, name: user.name,
    cpf: user.cpf, role: user.role, walletCents: user.walletCents,
    // dados de recebimento (lavador/comissionado/aluguel)
    pixChave: user.pixChave, pixTipo: user.pixTipo,
    solicitacoes,
    // loja de conveniência
    codigoCliente: user.codigoCliente,
    nascimento: user.nascimento ? user.nascimento.toISOString().slice(0, 10) : null,
    termosAceitos: user.termosVersao === TERMOS_VERSAO,
    temFoto: !!foto,
  };
}
