import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { chaveEndereco } from "@/lib/endereco";

/**
 * Auto-cadastro de loja de conveniência: mesma lógica do cadastro de máquina
 * (/api/machine/provisionar). No PRIMEIRO USO, o computador central da loja
 * gera a própria identidade (deviceKey) e o técnico escolhe o endereço numa
 * lista (/api/loja/unidades) ou digita um novo.
 *
 * Três formas de dizer onde a loja fica:
 *  - lojaId: loja JÁ CADASTRADA (escolhida na lista, ou criada antes no admin).
 *  - stationId: endereço de uma unidade de lavagem — a loja nasce no mesmo
 *    endereço, vinculada a ela.
 *  - cidade+rua: procura loja (e unidade de lavagem) com esse endereço,
 *    ignorando acento/maiúscula/"Rua", antes de criar um endereço novo.
 *
 * Loja nova nasce FECHADA (active=false) e sem dono: o admin define o dono e
 * abre em /admin/lojas quando estiver pronta — diferente da máquina de
 * lavagem, uma loja recém-ligada ainda não tem estoque nem responsável.
 *
 * Trocar o computador de uma loja que já tem um vinculado exige
 * substituir=true (equivale ao "trocou o display" da lavagem).
 *
 * Protegido por PROVISION_SECRET. FASE DE TESTE: sem a env var, fica aberto.
 */
const Body = z
  .object({
    deviceKey: z.string().min(8), // identidade do computador da loja, gerada por ele
    lojaId: z.string().optional(),
    stationId: z.string().optional(),
    cidade: z.string().trim().min(1).optional(),
    rua: z.string().trim().min(1).optional(),
    nome: z.string().trim().min(1).max(60).optional(),
    substituir: z.boolean().optional(),
  })
  .refine((b) => b.lojaId || b.stationId || (b.cidade && b.rua), {
    message: "Informe lojaId, stationId OU cidade+rua",
  });

export async function POST(req: NextRequest) {
  const secret = process.env.PROVISION_SECRET;
  if (secret && req.headers.get("x-provision-secret") !== secret)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { deviceKey, lojaId, stationId, cidade, rua, nome, substituir } = parsed.data;

  // 1) acha a loja de destino (ou os dados pra criar uma)
  let loja = null as Awaited<ReturnType<typeof prisma.loja.findUnique>>;
  let nova: { name: string; city: string; address: string; state?: string; stationId: string | null } | null = null;

  if (lojaId) {
    loja = await prisma.loja.findUnique({ where: { id: lojaId } });
    if (!loja) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  } else if (stationId) {
    const station = await prisma.washStation.findUnique({ where: { id: stationId } });
    if (!station) return NextResponse.json({ error: "Unidade não encontrada" }, { status: 404 });
    loja = await prisma.loja.findFirst({ where: { stationId } });
    if (!loja)
      nova = { name: nome ?? station.name, city: station.city, address: station.address, state: station.state, stationId };
  } else {
    // Total de lojas/unidades é pequeno: traz tudo e compara em memória,
    // igual ao cadastro de máquina.
    const alvo = chaveEndereco(cidade!, rua!);
    const [lojas, unidades] = await Promise.all([prisma.loja.findMany(), prisma.washStation.findMany()]);
    loja = lojas.find((l) => chaveEndereco(l.city, l.address) === alvo) ?? null;
    if (!loja) {
      const station = unidades.find((s) => chaveEndereco(s.city, s.address) === alvo);
      nova = station
        ? { name: nome ?? station.name, city: station.city, address: station.address, state: station.state, stationId: station.id }
        : { name: nome ?? rua!, city: cidade!, address: rua!, stationId: null };
    }
  }

  // 2) este computador já é de outra loja?
  const doComputador = await prisma.loja.findUnique({ where: { deviceKey } });
  if (doComputador && doComputador.id !== loja?.id)
    return NextResponse.json(
      { error: `Este computador já está cadastrado na loja "${doComputador.name}"` },
      { status: 409 }
    );

  // 3) a loja já tem outro computador?
  if (loja?.deviceKey && loja.deviceKey !== deviceKey && !substituir)
    return NextResponse.json(
      { error: "Esta loja já tem um computador vinculado. Para trocar o computador, confirme a substituição.", precisaSubstituir: true },
      { status: 409 }
    );

  const criada = !loja;
  const resultado = loja
    ? await prisma.loja.update({ where: { id: loja.id }, data: { deviceKey } })
    : await prisma.loja.create({ data: { ...nova!, deviceKey, active: false } });

  await prisma.event.create({
    data: {
      type: criada ? "loja_provisioned" : "loja_reprovisioned",
      payload: { lojaId: resultado.id, stationId: resultado.stationId, substituiu: !!(loja?.deviceKey && loja.deviceKey !== deviceKey) },
    },
  });

  return NextResponse.json({
    ok: true,
    criada,
    loja: {
      id: resultado.id, nome: resultado.name, cidade: resultado.city, rua: resultado.address,
      capacidade: resultado.capacidade, aberta: resultado.active,
    },
  });
}
