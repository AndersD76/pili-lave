import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { lojaConfigurada } from "@/lib/config";
import { identificarRosto, type IdentificacaoCaixa } from "@/lib/rosto";
import { visitasAtivas } from "@/lib/visitas";

const Body = z.object({ imagemBase64: z.string().min(100).max(4_000_000).nullish() });

/**
 * O totem manda um quadro da câmera e pergunta quem é — a comparação é só
 * entre quem está DENTRO da loja agora. Identificar não cobra nada: só diz
 * de quem é a compra; o pagamento continua sendo o QR da carteira ou o cartão.
 */
export async function POST(req: NextRequest) {
  if (!(await lojaConfigurada())) return NextResponse.json({ situacao: "NINGUEM" } satisfies IdentificacaoCaixa);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const ativas = await visitasAtivas();
  if (ativas.length === 0) return NextResponse.json({ situacao: "NINGUEM" } satisfies IdentificacaoCaixa);

  const visitas = ativas.map((v) => ({ visitaId: v.id, nome: v.nome }));
  const imagem = parsed.success ? parsed.data.imagemBase64?.replace(/^data:image\/\w+;base64,/, "") : null;
  const candidatos = ativas.map((v) => v.nuvemUserId).filter((id): id is string => !!id);
  if (!imagem || candidatos.length === 0) return NextResponse.json({ situacao: "ESCOLHER", visitas } satisfies IdentificacaoCaixa);

  const r = await identificarRosto(imagem, candidatos);
  if (r.situacao === "OK") {
    const visita = ativas.find((v) => v.nuvemUserId === r.clienteId);
    if (visita) return NextResponse.json({ situacao: "OK", visitaId: visita.id, nome: visita.nome } satisfies IdentificacaoCaixa);
  }
  if (r.situacao === "SEM_ROSTO") return NextResponse.json({ situacao: "SEM_ROSTO", visitas } satisfies IdentificacaoCaixa);
  return NextResponse.json({ situacao: "ESCOLHER", visitas } satisfies IdentificacaoCaixa);
}
