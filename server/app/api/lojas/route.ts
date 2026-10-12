import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

/**
 * Lojas de conveniência abertas, do ponto de vista do cliente logado: em
 * cada uma, se ele está bloqueado e as mensagens que já mandou pro suporte
 * (com a resposta do dono, quando houver).
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const lojas = await prisma.loja.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    include: {
      bloqueios: { where: { userId: auth.user.id, removidoEm: null }, select: { id: true } },
      mensagens: {
        where: { userId: auth.user.id },
        orderBy: { criadaEm: "desc" },
        take: 10,
        select: { id: true, texto: true, criadaEm: true, resposta: true, respondidaEm: true },
      },
    },
  });

  return NextResponse.json({
    lojas: lojas.map((l) => ({
      id: l.id, name: l.name, address: l.address, city: l.city, state: l.state,
      capacidade: l.capacidade,
      // o motivo do bloqueio fica só com o dono — o cliente fala pelo suporte
      bloqueado: l.bloqueios.length > 0,
      mensagens: l.mensagens,
    })),
  });
}
