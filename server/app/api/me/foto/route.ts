import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { conferirFotoRosto } from "@/lib/rosto";
import { TERMOS_VERSAO } from "@/lib/termos";

/* A PWA reduz pra 640px antes de mandar (~60 KB); o app nativo depende dos
 * tamanhos que a câmera do aparelho oferece, então o teto é folgado. */
const MAX_BYTES = 1024 * 1024;

const Body = z.object({
  jpegBase64: z.string().min(100),
  /* Autorização ESPECÍFICA pra biometria (LGPD) — separada do aceite do
   * termo de uso. Sem ela marcada, a foto não é guardada. */
  consentimento: z.literal(true),
});

/**
 * Foto do rosto — exigida só pra usar a loja de conveniência. Mandar de
 * novo substitui a anterior (uma foto por pessoa).
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  if (auth.user.termosVersao !== TERMOS_VERSAO)
    return NextResponse.json({ error: "Aceite o termo de uso antes de enviar a foto" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Envie a foto e marque a autorização de uso da imagem" }, { status: 400 });

  const jpeg = Buffer.from(parsed.data.jpegBase64, "base64");
  // todo JPEG começa com FF D8 — barra qualquer outra coisa mandada no lugar
  if (jpeg.length < 3 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8)
    return NextResponse.json({ error: "A foto precisa ser uma imagem JPEG" }, { status: 400 });
  if (jpeg.length > MAX_BYTES) return NextResponse.json({ error: "Foto grande demais" }, { status: 413 });

  // Tem que ser o rosto de uma pessoa — garrafa, parede ou foto em grupo
  // não entram. Se não der pra conferir (IA fora do ar), a foto é aceita e
  // fica marcada como não conferida, pra não travar o cadastro.
  const conferencia = await conferirFotoRosto(jpeg);
  if (conferencia.situacao === "RECUSADA") {
    await prisma.event.create({
      data: { type: "foto_rosto_recusada", payload: { userId: auth.user.id, mensagem: conferencia.mensagem } },
    });
    return NextResponse.json({ error: conferencia.mensagem }, { status: 422 });
  }
  const conferida = conferencia.situacao === "APROVADA";

  const agora = new Date();
  await prisma.fotoRosto.upsert({
    where: { userId: auth.user.id },
    create: { userId: auth.user.id, jpeg, bytes: jpeg.length, consentimentoEm: agora, conferida },
    update: { jpeg, bytes: jpeg.length, consentimentoEm: agora, criadaEm: agora, conferida },
  });
  await prisma.event.create({
    data: {
      type: "foto_rosto_enviada",
      payload: {
        userId: auth.user.id, bytes: jpeg.length, conferida,
        ...(conferencia.situacao === "NAO_CONFERIDA" ? { motivo: conferencia.motivo } : {}),
      },
    },
  });
  return NextResponse.json({ ok: true });
}
