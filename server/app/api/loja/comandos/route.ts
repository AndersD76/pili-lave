import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ABERTURA_VALIDADE_MS, lojaPorDeviceKey } from "@/lib/loja";

/**
 * O que a nuvem tem pra esta loja agora — o computador da loja pergunta de
 * tempos em tempos:
 * - `bloqueados`: códigos dos clientes que o dono impediu de entrar (lista
 *   inteira, pra a loja guardar e barrar mesmo sem internet);
 * - `aberturasRemotas`: pedidos do dono pra abrir a porta, ainda válidos e
 *   não atendidos. Depois de abrir, a loja confirma em
 *   POST /api/loja/comandos/{id}/feito.
 */
export async function GET(req: NextRequest) {
  const loja = await lojaPorDeviceKey(req);
  if (!loja) return NextResponse.json({ erro: "Loja não identificada" }, { status: 401 });

  const [bloqueios, aberturas] = await Promise.all([
    prisma.lojaBloqueio.findMany({
      where: { lojaId: loja.id, removidoEm: null },
      select: { user: { select: { codigoCliente: true } } },
    }),
    prisma.lojaAberturaRemota.findMany({
      where: { lojaId: loja.id, feitaEm: null, pedidaEm: { gt: new Date(Date.now() - ABERTURA_VALIDADE_MS) } },
      orderBy: { pedidaEm: "asc" },
      include: { pedidaPor: { select: { name: true } } },
    }),
  ]);

  return NextResponse.json({
    bloqueados: bloqueios.map((b) => b.user.codigoCliente),
    aberturasRemotas: aberturas.map((a) => ({
      id: a.id, pedidaPor: a.pedidaPor.name ?? "Dono da loja", motivo: a.motivo, pedidaEm: a.pedidaEm,
    })),
    capacidade: loja.capacidade,
    aberta: loja.active,
  });
}
