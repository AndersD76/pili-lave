import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { bloqueioAtivo, lojaDoDono } from "@/lib/loja";

const Body = z.object({
  codigoCliente: z.coerce.number().int().positive(),
  motivo: z.string().trim().min(3, "Informe o motivo do bloqueio").max(300),
});

/**
 * Dono bloqueia a entrada de um cliente na loja dele (problema de conduta).
 * O cliente é indicado pelo código único — o mesmo que a loja registra na
 * entrada. O motivo fica só com o dono; o cliente vê apenas que está
 * bloqueado e o caminho do suporte.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const loja = await lojaDoDono(id, auth.user.id);
  if (!loja) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const cliente = await prisma.user.findUnique({ where: { codigoCliente: parsed.data.codigoCliente } });
  if (!cliente) return NextResponse.json({ error: "Não existe cliente com esse código" }, { status: 404 });
  if (cliente.id === auth.user.id)
    return NextResponse.json({ error: "Você não pode bloquear a si mesmo" }, { status: 400 });
  if (await bloqueioAtivo(id, cliente.id))
    return NextResponse.json({ error: "Esse cliente já está bloqueado nesta loja" }, { status: 409 });

  const bloqueio = await prisma.lojaBloqueio.create({
    data: { lojaId: id, userId: cliente.id, motivo: parsed.data.motivo },
  });
  await prisma.event.create({
    data: { type: "loja_bloqueio", payload: { lojaId: id, userId: cliente.id, donoId: auth.user.id } },
  });
  return NextResponse.json(
    { id: bloqueio.id, motivo: bloqueio.motivo, criadoEm: bloqueio.criadoEm,
      cliente: { nome: cliente.name, codigo: cliente.codigoCliente } },
    { status: 201 }
  );
}
