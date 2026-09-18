import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// -----------------------------------------------------------------------
// Seed de SIMULAÇÃO — só pra testar a tela /admin/maquinas com dados
// variados (10 máquinas, um endereço com 2, outro com 3, históricos com
// cancelamento/defeito/lavagem normal). SEMPRE roda contra o banco do
// DATABASE_URL atual — nunca rodar isso apontando pra produção.
// -----------------------------------------------------------------------

const AGORA = Date.now();
const h = (horasAtras: number) => new Date(AGORA - horasAtras * 3600_000);
const d = (diasAtras: number) => new Date(AGORA - diasAtras * 86_400_000);

async function garantirUsuario(phone: string, name: string, placa: string) {
  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone, name, walletCents: 5000 },
  });
  const vehicle = await prisma.vehicle.upsert({
    where: { id: `veic_${placa}` },
    update: {},
    create: { id: `veic_${placa}`, userId: user.id, plate: placa, defaultProgramId: 1 },
  });
  return { user, vehicle };
}

async function garantirStation(nome: string, cidade: string, endereco: string) {
  const existente = await prisma.washStation.findFirst({ where: { city: cidade, address: endereco } });
  if (existente) return existente;
  return prisma.washStation.create({ data: { name: nome, city: cidade, address: endereco } });
}

async function garantirMaquina(stationId: string, numero: number, deviceKey: string, opts: {
  status: "FREE" | "WASHING" | "FAULT" | "OFFLINE" | "MAINTENANCE";
  lastHeartbeat: Date | null;
  lastPaymentDate: Date | null;
}) {
  return prisma.machine.upsert({
    where: { deviceKey },
    update: { status: opts.status, lastHeartbeat: opts.lastHeartbeat, lastPaymentDate: opts.lastPaymentDate, numero, stationId },
    create: {
      stationId, numero, deviceKey, name: `Máquina ${numero}`,
      status: opts.status, lastHeartbeat: opts.lastHeartbeat, lastPaymentDate: opts.lastPaymentDate,
    },
  });
}

async function criarReserva(opts: {
  userId: string; vehicleId: string; machineId: string; stationId: string; programId: number;
  amountCents: number; status: "COMPLETED" | "CANCELED" | "FAILED" | "EXPIRED";
  quandoAtras: number; // horas atrás pro createdAt/completedAt
}) {
  const base = h(opts.quandoAtras);
  await prisma.reservation.create({
    data: {
      userId: opts.userId, vehicleId: opts.vehicleId, machineId: opts.machineId, stationId: opts.stationId,
      programId: opts.programId, amountCents: opts.amountCents, status: opts.status,
      expiresAt: new Date(base.getTime() + 3600_000),
      activeAt: opts.status === "COMPLETED" ? base : null,
      enteredAt: opts.status === "COMPLETED" ? base : null,
      completedAt: opts.status === "COMPLETED" ? new Date(base.getTime() + 20 * 60_000) : null,
      createdAt: base,
    },
  });
}

async function main() {
  // Clientes de teste (reaproveitados entre as reservas)
  const clientes = [
    await garantirUsuario("+5551988880001", "Marcos Vieira", "ABC1D23"),
    await garantirUsuario("+5551988880002", "Fernanda Souza", "JKL4E56"),
    await garantirUsuario("+5551988880003", "Rodrigo Alves", "MNO7F89"),
    await garantirUsuario("+5551988880004", "Camila Dutra", "PQR1G23"),
    await garantirUsuario("+5551988880005", "Bruno Kanieski", "STU4H56"),
  ];
  const prog = [1, 2, 3, 4]; // ids dos Program já seedados (Simples/Completa/Premium/VIP)
  const precoDoPrograma: Record<number, number> = { 1: 1500, 2: 2500, 3: 4000, 4: 5500 };

  // ---- Unidades (uma com 2 máquinas, outra com 3, resto com 1) ----
  const stPortoAlegre  = await garantirStation("Av. Ipiranga",        "Porto Alegre",     "Av. Ipiranga, 1200");
  const stCaxias       = await garantirStation("Rua Sinimbu",         "Caxias do Sul",    "Rua Sinimbu, 850");     // 2 máquinas
  const stNovoHamburgo = await garantirStation("Rua Sete de Setembro","Novo Hamburgo",    "Rua Sete de Setembro, 430"); // 3 máquinas
  const stGramado      = await garantirStation("Av. Borges de Medeiros", "Gramado",       "Av. Borges de Medeiros, 2100");
  const stBento        = await garantirStation("Rua Marechal Deodoro","Bento Gonçalves",  "Rua Marechal Deodoro, 77");
  const stCanoas       = await garantirStation("Av. Guilherme Schell","Canoas",           "Av. Guilherme Schell, 590");
  const stPelotas      = await garantirStation("Rua Andrade Neves",   "Pelotas",          "Rua Andrade Neves, 1340");

  const mPoa    = await garantirMaquina(stPortoAlegre.id, 1, "sim_poa_01",     { status: "FREE",        lastHeartbeat: h(0.05), lastPaymentDate: d(10) });
  const mCax1   = await garantirMaquina(stCaxias.id,      1, "sim_caxias_01",  { status: "FREE",        lastHeartbeat: h(0.02), lastPaymentDate: d(5) });
  const mCax2   = await garantirMaquina(stCaxias.id,      2, "sim_caxias_02",  { status: "WASHING",     lastHeartbeat: h(0.01), lastPaymentDate: d(48) });
  const mNh1    = await garantirMaquina(stNovoHamburgo.id,1, "sim_nh_01",      { status: "FREE",        lastHeartbeat: h(0.03), lastPaymentDate: d(2) });
  const mNh2    = await garantirMaquina(stNovoHamburgo.id,2, "sim_nh_02",      { status: "FAULT",       lastHeartbeat: h(0.2),  lastPaymentDate: d(55) }); // licença bloqueada
  const mNh3    = await garantirMaquina(stNovoHamburgo.id,3, "sim_nh_03",      { status: "MAINTENANCE", lastHeartbeat: h(1),    lastPaymentDate: d(20) });
  const mGramado= await garantirMaquina(stGramado.id,     1, "sim_gramado_01",{ status: "FREE",        lastHeartbeat: h(0.05), lastPaymentDate: d(1) });
  const mBento  = await garantirMaquina(stBento.id,       1, "sim_bento_01",  { status: "OFFLINE",     lastHeartbeat: d(3),    lastPaymentDate: d(42) }); // aviso de licença
  const mCanoas = await garantirMaquina(stCanoas.id,      1, "sim_canoas_01", { status: "FREE",        lastHeartbeat: h(0.1),  lastPaymentDate: null }); // sem registro de pagamento
  const mPelotas= await garantirMaquina(stPelotas.id,     1, "sim_pelotas_01",{ status: "FAULT",       lastHeartbeat: h(0.4),  lastPaymentDate: d(15) });

  const maquinas = [mPoa, mCax1, mCax2, mNh1, mNh2, mNh3, mGramado, mBento, mCanoas, mPelotas];
  console.log(`${maquinas.length} máquinas em 7 unidades (Caxias=2, Novo Hamburgo=3).`);

  // ---- Histórico variado por máquina: lavagens concluídas, cancelamentos,
  // e falhas (simulando defeito de sensor) ----
  let contador = 0;
  for (const m of maquinas) {
    const cliente = clientes[contador % clientes.length];
    const cliente2 = clientes[(contador + 2) % clientes.length];
    const programaA = prog[contador % prog.length];
    const programaB = prog[(contador + 1) % prog.length];

    // 2-3 lavagens concluídas normais
    await criarReserva({
      userId: cliente.user.id, vehicleId: cliente.vehicle.id, machineId: m.id, stationId: m.stationId,
      programId: programaA, amountCents: precoDoPrograma[programaA], status: "COMPLETED", quandoAtras: 4 + contador,
    });
    await criarReserva({
      userId: cliente2.user.id, vehicleId: cliente2.vehicle.id, machineId: m.id, stationId: m.stationId,
      programId: programaB, amountCents: precoDoPrograma[programaB], status: "COMPLETED", quandoAtras: 26 + contador,
    });
    if (contador % 2 === 0) {
      await criarReserva({
        userId: cliente.user.id, vehicleId: cliente.vehicle.id, machineId: m.id, stationId: m.stationId,
        programId: programaA, amountCents: precoDoPrograma[programaA], status: "COMPLETED", quandoAtras: 50 + contador,
      });
    }

    // Cancelamento (motorista desistiu antes de entrar)
    await criarReserva({
      userId: cliente2.user.id, vehicleId: cliente2.vehicle.id, machineId: m.id, stationId: m.stationId,
      programId: programaA, amountCents: precoDoPrograma[programaA], status: "CANCELED", quandoAtras: 12 + contador,
    });

    // Falha (AUTO_ERRO / sensor) — mais frequente nas máquinas já marcadas FAULT
    if (m.status === "FAULT" || contador % 3 === 0) {
      await criarReserva({
        userId: cliente.user.id, vehicleId: cliente.vehicle.id, machineId: m.id, stationId: m.stationId,
        programId: programaB, amountCents: precoDoPrograma[programaB], status: "FAILED", quandoAtras: 6 + contador,
      });
    }

    contador++;
  }

  console.log("Histórico de simulação criado (concluídas, canceladas e com falha de sensor).");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
