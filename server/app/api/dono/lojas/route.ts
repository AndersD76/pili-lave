import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const CLIENTE = { select: { name: true, codigoCliente: true } } as const;

/**
 * Painel do dono: só as lojas em que ele é o dono (Loja.donoId), com os
 * clientes bloqueados e as mensagens de suporte recebidas.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const lojas = await prisma.loja.findMany({
    where: { donoId: auth.user.id },
    orderBy: { name: "asc" },
    include: {
      bloqueios: { where: { removidoEm: null }, orderBy: { criadoEm: "desc" }, include: { user: CLIENTE } },
      mensagens: { orderBy: { criadaEm: "desc" }, take: 50, include: { user: CLIENTE } },
    },
  });

  return NextResponse.json({
    lojas: lojas.map((l) => {
      const bloqueados = new Set(l.bloqueios.map((b) => b.userId));
      return {
        id: l.id, name: l.name, address: l.address, city: l.city, state: l.state,
        active: l.active, capacidade: l.capacidade,
        bloqueios: l.bloqueios.map((b) => ({
          id: b.id, motivo: b.motivo, criadoEm: b.criadoEm,
          cliente: { nome: b.user.name, codigo: b.user.codigoCliente },
        })),
        mensagens: l.mensagens.map((m) => ({
          id: m.id, texto: m.texto, criadaEm: m.criadaEm, resposta: m.resposta, respondidaEm: m.respondidaEm,
          cliente: { nome: m.user.name, codigo: m.user.codigoCliente, bloqueado: bloqueados.has(m.userId) },
        })),
      };
    }),
  });
}
