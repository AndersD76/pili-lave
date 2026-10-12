import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chaveEndereco, normalizarEndereco } from "@/lib/endereco";

/**
 * Busca de endereços já cadastrados por cidade — usada pela tela de primeiro
 * uso do computador da loja ANTES de criar um endereço novo (mesma ideia do
 * /api/machine/unidades do display). Junta as lojas que já existem com as
 * unidades de lavagem: uma loja instalada ao lado de um lava-rápido escolhe
 * o endereço dele em vez de digitar de novo. Protegida pelo PROVISION_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.PROVISION_SECRET;
  if (secret && req.headers.get("x-provision-secret") !== secret)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const cidade = req.nextUrl.searchParams.get("cidade")?.trim();
  if (!cidade || cidade.length < 2)
    return NextResponse.json({ error: "Informe ao menos 2 letras da cidade" }, { status: 400 });
  const alvo = normalizarEndereco(cidade);

  const [lojas, unidades] = await Promise.all([
    prisma.loja.findMany({ orderBy: { address: "asc" } }),
    prisma.washStation.findMany({ orderBy: { address: "asc" } }),
  ]);

  const enderecos: {
    lojaId: string | null; stationId: string | null; cidade: string; rua: string; nome: string;
    /** true = já tem um computador de loja vinculado a este endereço */
    temComputador: boolean;
  }[] = lojas
    .filter((l) => normalizarEndereco(l.city).includes(alvo))
    .map((l) => ({
      lojaId: l.id, stationId: l.stationId, cidade: l.city, rua: l.address, nome: l.name,
      temComputador: !!l.deviceKey,
    }));

  // unidades de lavagem que ainda não têm loja no mesmo endereço
  const comLoja = new Set(lojas.map((l) => chaveEndereco(l.city, l.address)));
  const stationsComLoja = new Set(lojas.map((l) => l.stationId).filter(Boolean));
  for (const s of unidades) {
    if (!normalizarEndereco(s.city).includes(alvo)) continue;
    if (stationsComLoja.has(s.id) || comLoja.has(chaveEndereco(s.city, s.address))) continue;
    enderecos.push({ lojaId: null, stationId: s.id, cidade: s.city, rua: s.address, nome: s.name, temComputador: false });
  }

  return NextResponse.json({ enderecos: enderecos.slice(0, 20) });
}
