import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const programas = [
  { id: 1, nome: "Simples", precoCents: 1500, duracaoMin: 15, ordem: 1 },
  { id: 2, nome: "Completa", precoCents: 2500, duracaoMin: 25, ordem: 2 },
  { id: 3, nome: "Premium", precoCents: 4000, duracaoMin: 35, ordem: 3 },
  { id: 4, nome: "VIP", precoCents: 5500, duracaoMin: 45, ordem: 4 },
];

async function main() {
  for (const p of programas) {
    await prisma.program.upsert({
      where: { id: p.id },
      update: { duracaoMin: p.duracaoMin },
      create: p,
    });
  }

  // Primeira unidade + máquina (edite endereço/coordenadas reais no admin ou aqui)
  let station = await prisma.washStation.findFirst();
  if (!station) {
    station = await prisma.washStation.create({
      data: {
        name: "Pili Lave — Unidade 1",
        address: "PREENCHER ENDEREÇO",
        city: "PREENCHER CIDADE",
        state: "RS",
        lat: null,
        lng: null,
      },
    });
  }
  const machine = await prisma.machine.findFirst({ where: { stationId: station.id } });
  if (!machine) {
    await prisma.machine.create({
      data: {
        stationId: station.id,
        name: "Máquina 1",
        deviceKey: process.env.MACHINE_DEVICE_KEY ?? `dev_${station.id.slice(-8)}`,
      },
    });
  }

  console.log("Seed ok: programas 1..4, estação e máquina padrão");
}

main().finally(() => prisma.$disconnect());
