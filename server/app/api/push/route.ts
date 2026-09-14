import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { chavePublicaPush } from "@/lib/push";

/** Chave pública do servidor — o navegador precisa dela para se inscrever. */
export async function GET() {
  return NextResponse.json({ chave: chavePublicaPush() });
}

const Body = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

/** Registra o aparelho do cliente para receber avisos. */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const { endpoint, keys } = parsed.data;
  // o mesmo aparelho pode trocar de dono (celular emprestado/revendido):
  // o endpoint é único, então sempre aponta para quem se inscreveu por último
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: auth.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    update: { userId: auth.user.id, p256dh: keys.p256dh, auth: keys.auth },
  });
  return NextResponse.json({ ok: true });
}

/** Desliga os avisos neste aparelho. */
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const endpoint = req.nextUrl.searchParams.get("endpoint");
  if (!endpoint) return NextResponse.json({ error: "endpoint obrigatório" }, { status: 400 });
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: auth.user.id } });
  return NextResponse.json({ ok: true });
}
