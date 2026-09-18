import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Busca de unidades já cadastradas por cidade — usada pela tela de cadastro
 * do display ANTES de criar uma unidade nova, pra evitar duplicata quando o
 * técnico digita o endereço um pouco diferente do que já existe (ex.: "Joao
 * Carlon" sem "Rua" na frente). Protegida pelo mesmo PROVISION_SECRET do
 * /api/machine/provisionar.
 */
function normalizarEndereco(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim().replace(/\s+/g, " ");
}

export async function GET(req: NextRequest) {
  const secret = process.env.PROVISION_SECRET;
  if (secret && req.headers.get("x-provision-secret") !== secret)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const cidade = req.nextUrl.searchParams.get("cidade")?.trim();
  if (!cidade || cidade.length < 2)
    return NextResponse.json({ error: "Informe ao menos 2 letras da cidade" }, { status: 400 });

  const alvo = normalizarEndereco(cidade);
  const todas = await prisma.washStation.findMany({
    orderBy: { address: "asc" },
    include: { machines: { select: { numero: true } } },
  });
  const unidades = todas
    .filter((s) => normalizarEndereco(s.city).includes(alvo))
    .slice(0, 20)
    .map((s) => {
      const maiorNumero = s.machines.reduce((max, m) => Math.max(max, m.numero), 0);
      return { stationId: s.id, cidade: s.city, rua: s.address, proximoNumero: maiorNumero + 1 };
    });

  return NextResponse.json({ unidades });
}
