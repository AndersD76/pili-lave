import { prisma } from "@/lib/prisma";
import type { User, TipoParticipacao, StatusSolicitacao } from "@prisma/client";

export type SolicitacaoResumo = { tipo: TipoParticipacao; status: StatusSolicitacao };

/** Formato comum devolvido em /api/auth/register, /api/auth/login e
 *  /api/me — inclui as solicitações de participação (Lavador/Comissão
 *  1/2/Aluguel) pra o app saber o que já foi pedido/aprovado/rejeitado
 *  sem precisar de outra chamada. */
export async function meComSolicitacoes(user: User) {
  const solicitacoes: SolicitacaoResumo[] = await prisma.solicitacaoParceiro.findMany({
    where: { userId: user.id },
    select: { tipo: true, status: true },
  });
  return {
    id: user.id, phone: user.phone, email: user.email, name: user.name,
    cpf: user.cpf, role: user.role, walletCents: user.walletCents,
    solicitacoes,
  };
}
