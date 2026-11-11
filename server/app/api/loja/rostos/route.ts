import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lojaPorDeviceKey } from "@/lib/loja";

/** Fotos por chamada — cada uma tem ~60 KB (até 1 MB no app nativo). */
const POR_PAGINA = 40;

/**
 * Cópia local do banco de rostos: o computador da loja chama aqui em
 * segundo plano pra ter a foto de cada cliente mesmo sem internet.
 *
 * `desde` (ISO) = só o que mudou depois disso; sem ele vem tudo. Quem tirou
 * a foto (revogou a autorização) vem com `removido: true` e sem foto — a
 * loja apaga a cópia. As fotos vêm em páginas: enquanto `proximo` não for
 * null, chamar de novo com `&cursor=<proximo>`. Na próxima rodada, usar o
 * `agora` devolvido como `desde`.
 */
export async function GET(req: NextRequest) {
  const loja = await lojaPorDeviceKey(req);
  if (!loja) return NextResponse.json({ erro: "Loja não identificada" }, { status: 401 });

  const desdeTxt = req.nextUrl.searchParams.get("desde");
  const desde = desdeTxt ? new Date(desdeTxt) : null;
  if (desde && Number.isNaN(desde.getTime()))
    return NextResponse.json({ erro: "Parâmetro 'desde' inválido" }, { status: 400 });
  const cursor = req.nextUrl.searchParams.get("cursor");
  const agora = new Date();

  const fotos = await prisma.fotoRosto.findMany({
    where: desde ? { criadaEm: { gt: desde } } : {},
    orderBy: [{ criadaEm: "asc" }, { userId: "asc" }],
    take: POR_PAGINA + 1,
    ...(cursor ? { cursor: { userId: cursor }, skip: 1 } : {}),
    include: { user: { select: { codigoCliente: true, name: true } } },
  });
  const temMais = fotos.length > POR_PAGINA;
  const pagina = temMais ? fotos.slice(0, POR_PAGINA) : fotos;

  // As remoções são linhas pequenas: vão todas na primeira página.
  const removidos = cursor
    ? []
    : await prisma.rostoRemovido.findMany({ where: desde ? { removidoEm: { gt: desde } } : {} });

  return NextResponse.json({
    clientes: [
      ...removidos.map((r) => ({
        userId: r.userId, codigoCliente: r.codigoCliente, nome: null, fotoBase64: null,
        removido: true, atualizadoEm: r.removidoEm,
      })),
      ...pagina.map((f) => ({
        userId: f.userId, codigoCliente: f.user.codigoCliente, nome: f.user.name,
        fotoBase64: Buffer.from(f.jpeg).toString("base64"), removido: false, atualizadoEm: f.criadaEm,
      })),
    ],
    proximo: temMais ? pagina[pagina.length - 1].userId : null,
    agora,
  });
}
