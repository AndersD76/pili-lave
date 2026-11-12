// Teste da regra "sem fila" (2026-11-12): reserva = autorizacao do carro; o carro autorizado que chega e liberado na hora; so nao interrompe
// a lavagem em andamento. Chama handlePlateRead direto contra o banco LOCAL (aborta se nao for local). Cria e apaga os proprios dados.
// Rodar (de dentro de server/): npx tsx _teste_sem_fila.mts
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])
);
if (!/localhost|127\.0\.0\.1/.test(env.DATABASE_URL)) throw new Error("DATABASE_URL não é local — abortado");
Object.assign(process.env, env);

const prisma = new PrismaClient();
const { handlePlateRead } = await import("./lib/lpr");
const { pendingStart } = await import("./lib/reservations");

let falhas = 0;
const ok = (cond: boolean, nome: string) => { console.log(cond ? "  ok   " : "  FALHOU", nome); if (!cond) falhas++; };
const tag = `t${Date.now().toString(36)}`;
const ids: { users: string[]; vehicles: string[]; reservations: string[]; station?: string; machine?: string } = { users: [], vehicles: [], reservations: [] };

try {
  const station = await prisma.washStation.create({ data: { name: `Teste ${tag}` } });
  ids.station = station.id;
  const machine = await prisma.machine.create({ data: { stationId: station.id, name: "M teste", deviceKey: `dev_${tag}`, status: "FREE", lastHeartbeat: new Date() } });
  ids.machine = machine.id;
  const program = (await prisma.program.findFirst({ where: { ativo: true } })) ?? (await prisma.program.create({ data: { id: 99, nome: "Teste", precoCents: 100 } }));

  // 3 carros autorizados: A, B, C
  const placas = ["TST1A11", "TST2B22", "TST3C33"];
  const carros: { plate: string; vehicleId: string; reservationId: string }[] = [];
  for (const [i, plate] of placas.entries()) {
    const u = await prisma.user.create({ data: { phone: `+55000${tag}${i}`, name: `Cliente ${plate}`, walletCents: 1000 } });
    ids.users.push(u.id);
    const v = await prisma.vehicle.create({ data: { userId: u.id, plate } });
    ids.vehicles.push(v.id);
    const r = await prisma.reservation.create({
      data: { userId: u.id, vehicleId: v.id, programId: program.id, amountCents: 100, status: "HELD", expiresAt: new Date(Date.now() + 3600e3) },
    });
    ids.reservations.push(r.id);
    carros.push({ plate, vehicleId: v.id, reservationId: r.id });
  }
  const [A, B, C] = carros;
  const estado = async (id: string) => (await prisma.reservation.findUnique({ where: { id } }))!.status;
  const fresca = async () => (await prisma.machine.findUnique({ where: { id: machine.id } }))!;   // a rota real le a máquina do banco a cada leitura
  const setMaquina = (data: Record<string, unknown>) => prisma.machine.update({ where: { id: machine.id }, data: { lastHeartbeat: new Date(), ...data } });

  console.log("1) máquina parada, status WASHING só porque há carro no X14/X15 (o caso de 12/11): o carro autorizado é liberado");
  await setMaquina({ status: "WASHING" });
  let r = await handlePlateRead(B.plate, await fresca());   // B chega primeiro (fora da ordem de criação)
  ok(r.light === "GREEN_SOLID", `B recebe verde sólido (veio ${r.light})`);
  ok((await estado(B.reservationId)) === "ACTIVE", "reserva de B virou ACTIVE");
  ok((await estado(A.reservationId)) === "HELD" && (await estado(C.reservationId)) === "HELD", "A e C continuam autorizados (HELD)");

  console.log("2) outro carro chega antes de B entrar: vale o que chegou (B volta a HELD, A é liberado)");
  r = await handlePlateRead(A.plate, await fresca());
  ok(r.light === "GREEN_SOLID", `A recebe verde sólido (veio ${r.light})`);
  ok((await estado(A.reservationId)) === "ACTIVE" && (await estado(B.reservationId)) === "HELD", "A ACTIVE, B voltou a HELD");
  const ps = await pendingStart(machine);
  ok(ps?.id === A.reservationId, "a máquina recebe a ordem de início do carro que chegou por último (A)");

  console.log("3) A entra (ENTERED): lavagem em andamento NÃO é interrompida; C que chega espera, sem ser liberado");
  await prisma.reservation.update({ where: { id: A.reservationId }, data: { status: "ENTERED", enteredAt: new Date() } });
  await setMaquina({ status: "WASHING" });
  r = await handlePlateRead(C.plate, await fresca());
  ok(r.light === "GREEN_BLINK", `C recebe verde piscando — aguarde (veio ${r.light})`);
  ok((await estado(C.reservationId)) === "HELD", "C segue HELD (não ativou)");
  ok((await estado(A.reservationId)) === "ENTERED", "A continua lavando (ENTERED)");
  ok((await pendingStart(machine))?.id === A.reservationId, "a ordem de início continua sendo a da lavagem em andamento");

  console.log("4) A termina; qualquer autorizado que chegar é liberado, sem ordem (C, depois B)");
  await prisma.reservation.update({ where: { id: A.reservationId }, data: { status: "COMPLETED", completedAt: new Date() } });
  await setMaquina({ status: "FREE" });
  r = await handlePlateRead(C.plate, await fresca());
  ok(r.light === "GREEN_SOLID" && (await estado(C.reservationId)) === "ACTIVE", `C é liberado (veio ${r.light})`);
  ok((await estado(B.reservationId)) === "HELD", "B segue autorizado");

  console.log("5) máquina em falha: nada é liberado");
  await prisma.reservation.update({ where: { id: C.reservationId }, data: { status: "HELD", machineId: null, activeAt: null } });
  await setMaquina({ status: "FAULT" });
  r = await handlePlateRead(B.plate, await fresca());
  ok(r.light === "RED_BLINK" && (await estado(B.reservationId)) === "HELD", `B recebe vermelho piscando e segue HELD (veio ${r.light})`);

  console.log("6) placa conhecida sem reserva paga: continua alternando verde/vermelho");
  const semReserva = await prisma.user.create({ data: { phone: `+55009${tag}`, name: "Sem reserva" } });
  ids.users.push(semReserva.id);
  const vs = await prisma.vehicle.create({ data: { userId: semReserva.id, plate: "TST9Z99" } });
  ids.vehicles.push(vs.id);
  await setMaquina({ status: "FREE" });
  r = await handlePlateRead("TST9Z99", await fresca());
  ok(r.light === "RED_GREEN_ALT", `sem reserva: ${r.light}`);
} finally {
  // limpeza: arrivals, eventos criados pelos testes, reservas, veiculos, usuarios, maquina e unidade
  await prisma.arrival.deleteMany({ where: { OR: [{ vehicleId: { in: ids.vehicles } }, { userId: { in: ids.users } }] } }).catch(() => {});
  await prisma.reservation.deleteMany({ where: { id: { in: ids.reservations } } }).catch(() => {});
  await prisma.vehicle.deleteMany({ where: { id: { in: ids.vehicles } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } }).catch(() => {});
  if (ids.machine) await prisma.machine.delete({ where: { id: ids.machine } }).catch(() => {});
  if (ids.station) await prisma.washStation.delete({ where: { id: ids.station } }).catch(() => {});
  await prisma.$disconnect();
}
console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exit(falhas === 0 ? 0 : 1);
