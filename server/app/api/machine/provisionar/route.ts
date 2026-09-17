import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/**
 * Auto-cadastro de máquina nova: o TÉCNICO faz isso pela tela do display na
 * primeira ligada, digitando (ou escolhendo) a unidade + o número da
 * máquina; o display manda pra cá junto com o ID único do próprio chip
 * ESP32 (não escolhido por ninguém — vem de fábrica, nunca se repete).
 *
 * Duas formas de identificar a unidade:
 *  - stationId: unidade JÁ CADASTRADA (o técnico escolheu numa lista) —
 *    evita duplicar "Erechim/João Carlon" com grafias diferentes.
 *  - cidade+rua: cria uma unidade NOVA (primeira máquina daquele endereço).
 *
 * Protegido por PROVISION_SECRET (a mesma senha gravada em todo firmware —
 * não é por instalação) pra ninguém de fora conseguir plantar máquina falsa
 * no seu sistema. FASE DE TESTE: sem a env var, fica aberto.
 */
const Body = z
  .object({
    provisionSecret: z.string().optional(),
    deviceKey: z.string().min(4), // ID único do chip (efuse MAC) — é a identidade da máquina
    numero: z.number().int().min(1).optional(), // sem isso, pega o próximo livre na unidade
    stationId: z.string().optional(),
    cidade: z.string().min(1).optional(),
    rua: z.string().min(1).optional(),
  })
  .refine((b) => b.stationId || (b.cidade && b.rua), {
    message: "Informe stationId OU cidade+rua",
  });

export async function POST(req: NextRequest) {
  const secret = process.env.PROVISION_SECRET;
  if (secret && req.headers.get("x-provision-secret") !== secret)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { deviceKey, stationId: stationIdInformado, cidade, rua } = parsed.data;

  const station = stationIdInformado
    ? await prisma.washStation.findUnique({ where: { id: stationIdInformado } })
    : await prisma.washStation.create({
        data: { name: rua!.trim(), city: cidade!.trim(), address: rua!.trim() },
      });
  if (!station) return NextResponse.json({ error: "Unidade não encontrada" }, { status: 404 });

  const jaExiste = await prisma.machine.findUnique({ where: { deviceKey } });

  const numero =
    parsed.data.numero ??
    jaExiste?.numero ??
    ((await prisma.machine.count({ where: { stationId: station.id } })) + 1);

  const ocupada = await prisma.machine.findUnique({
    where: { stationId_numero: { stationId: station.id, numero } },
  });
  if (ocupada && ocupada.deviceKey !== deviceKey)
    return NextResponse.json(
      { error: `Já existe a máquina número ${numero} nesta unidade (outro aparelho)` },
      { status: 409 }
    );

  const machine = await prisma.machine.upsert({
    where: { deviceKey },
    update: { stationId: station.id, numero, name: `Máquina ${numero}` },
    create: { deviceKey, stationId: station.id, numero, name: `Máquina ${numero}` },
  });

  await prisma.event.create({
    data: {
      type: jaExiste ? "machine_reprovisioned" : "machine_provisioned",
      payload: { machineId: machine.id, deviceKey, stationId: station.id, numero },
    },
  });

  return NextResponse.json({
    ok: true,
    machineId: machine.id,
    numero: machine.numero,
    unidade: { id: station.id, cidade: station.city, rua: station.address },
  });
}
