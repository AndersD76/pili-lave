import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

const Body = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string(),
});

/**
 * Login do LOJISTA no computador da loja. O programa da loja manda o e-mail
 * e a senha digitados, identificando-se pelo próprio deviceKey; a resposta
 * diz se essa conta é a dona DAQUELA loja (Loja.donoId, definido pelo admin
 * em /admin/lojas). Não devolve token nenhum: a sessão é do programa local.
 *
 *  401 — computador desconhecido, ou e-mail/senha errados
 *  403 — conta válida, mas não é a dona desta loja
 */
export async function POST(req: NextRequest) {
  const deviceKey = req.headers.get("x-device-key");
  const loja = deviceKey ? await prisma.loja.findUnique({ where: { deviceKey } }) : null;
  if (!loja) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  const user = parsed.success ? await prisma.user.findUnique({ where: { email: parsed.data.email } }) : null;
  // mesma resposta para e-mail inexistente e senha errada — não vaza qual cadastro existe
  if (!parsed.success || !user || !user.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash))
    return NextResponse.json({ error: "E-mail ou senha inválidos" }, { status: 401 });

  if (loja.donoId !== user.id) {
    await prisma.event.create({
      data: { type: "loja_dono_login_negado", payload: { lojaId: loja.id, userId: user.id } },
    });
    return NextResponse.json({ error: "Esta conta não é a dona desta loja" }, { status: 403 });
  }

  await prisma.event.create({ data: { type: "loja_dono_login", payload: { lojaId: loja.id, userId: user.id } } });
  return NextResponse.json({ ok: true, dono: { id: user.id, nome: user.name ?? user.email, email: user.email } });
}
