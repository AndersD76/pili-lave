import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/password";

const prisma = new PrismaClient();

async function main() {
  const lavador = await prisma.user.upsert({
    where: { phone: "+5551977770001" },
    update: { role: "LAVADOR", email: "lavador@teste.dev", passwordHash: hashPassword("Lavador123") },
    create: {
      phone: "+5551977770001",
      email: "lavador@teste.dev",
      passwordHash: hashPassword("Lavador123"),
      name: "Zé Lavador (teste)",
      role: "LAVADOR",
    },
  });
  console.log("Lavador criado:", lavador.phone, lavador.email);

  // Pega a primeira máquina da simulação (Porto Alegre) pra já vincular de exemplo.
  const maquina = await prisma.machine.findFirst({ orderBy: { createdAt: "asc" } });
  if (!maquina) { console.log("Nenhuma máquina encontrada — cadastre uma antes."); return; }

  await prisma.machine.update({ where: { id: maquina.id }, data: { operadorId: lavador.id } });
  console.log("Vinculado como operador da máquina:", maquina.id, "numero", maquina.numero);

  // Um pouco de lavagem presencial de exemplo, pra tela não ficar vazia.
  const dados = [
    { programId: 1, amountCents: 1500 },
    { programId: 1, amountCents: 1500 },
    { programId: 2, amountCents: 2500 },
    { programId: 3, amountCents: 4000 },
    { programId: 4, amountCents: 5500 },
  ];
  for (const d of dados) {
    await prisma.lavagemPresencial.create({ data: { machineId: maquina.id, ...d } });
  }
  console.log(`${dados.length} lavagens presenciais de exemplo criadas na máquina ${maquina.id}.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
