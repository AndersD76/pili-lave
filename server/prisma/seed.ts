import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const programas = [
  { id: 1, nome: "Simples", precoCents: 1500, ordem: 1 },
  { id: 2, nome: "Completa", precoCents: 2500, ordem: 2 },
  { id: 3, nome: "Premium", precoCents: 4000, ordem: 3 },
  { id: 4, nome: "VIP", precoCents: 5500, ordem: 4 },
];

async function main() {
  for (const p of programas) {
    await prisma.program.upsert({ where: { id: p.id }, update: {}, create: p });
  }
  console.log("Seed ok: programas 1..4");
}

main().finally(() => prisma.$disconnect());
