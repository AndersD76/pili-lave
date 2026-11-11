import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { lojaPorDeviceKey, TIPOS_ALERTA, type TipoAlerta } from "@/lib/loja";
import { avisarAdmins, avisarCliente } from "@/lib/push";

const MAX_IMAGENS = 6;
const MAX_BYTES_IMAGEM = 400 * 1024;

const Body = z.object({
  /** Gerado pela loja, único: reenviar depois de queda de rede não duplica. */
  codigo: z.string().min(8).max(100),
  tipo: z.enum(TIPOS_ALERTA),
  titulo: z.string().trim().min(1).max(120),
  detalhe: z.string().trim().max(2000).default(""),
  imagens: z.array(z.string()).max(MAX_IMAGENS).default([]),
  ocorridoEm: z.string(),
  /** Cliente envolvido, quando a loja souber — permite bloquear pelo aviso. */
  codigoCliente: z.number().int().positive().nullish(),
});

const TAG: Record<TipoAlerta, string> = {
  ESTOQUE_MINIMO: "loja-estoque", DIVERGENCIA: "loja-divergencia",
  SAIDA_SEM_PAGAR: "loja-saida", INVASAO: "loja-invasao",
};

/**
 * Aviso do computador da loja pro dono (estoque no mínimo, divergência de
 * prateleira, saída sem pagar, invasão), com as imagens do momento. Fica na
 * lista de avisos do dono no app e dispara o aviso no celular (push).
 */
export async function POST(req: NextRequest) {
  const loja = await lojaPorDeviceKey(req);
  if (!loja) return NextResponse.json({ erro: "Loja não identificada" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const d = parsed.data;

  const ocorridoEm = new Date(d.ocorridoEm);
  if (Number.isNaN(ocorridoEm.getTime())) return NextResponse.json({ erro: "ocorridoEm inválido" }, { status: 400 });

  const jpegs = d.imagens.map((b64) => Buffer.from(b64, "base64"));
  for (const j of jpegs) {
    if (j.length < 3 || j[0] !== 0xff || j[1] !== 0xd8)
      return NextResponse.json({ erro: "As imagens precisam ser JPEG" }, { status: 400 });
    if (j.length > MAX_BYTES_IMAGEM) return NextResponse.json({ erro: "Imagem grande demais" }, { status: 413 });
  }

  const existente = await prisma.lojaAlerta.findUnique({ where: { codigo: d.codigo } });
  if (existente) {
    if (existente.lojaId !== loja.id) return NextResponse.json({ erro: "Código já usado" }, { status: 409 });
    return NextResponse.json({ ok: true, id: existente.id, jaRecebido: true });
  }

  const alerta = await prisma.lojaAlerta.create({
    data: {
      lojaId: loja.id, codigo: d.codigo, tipo: d.tipo, titulo: d.titulo, detalhe: d.detalhe,
      codigoCliente: d.codigoCliente ?? null, ocorridoEm,
      imagens: { create: jpegs.map((jpeg, ordem) => ({ jpeg, ordem })) },
    },
  });

  const aviso = {
    titulo: `${d.titulo} — ${loja.name}`,
    corpo: d.detalhe.slice(0, 160) || "Abra o app para ver os detalhes.",
    url: "/app/minha-loja",
    // invasão nunca é substituída por outro aviso: cada uma aparece
    tag: d.tipo === "INVASAO" ? `loja-invasao-${alerta.id}` : TAG[d.tipo],
  };
  if (loja.donoId) void avisarCliente(loja.donoId, aviso);
  else void avisarAdmins(aviso);

  return NextResponse.json({ ok: true, id: alerta.id }, { status: 201 });
}
