// SÓ LEITURA no banco de PRODUÇÃO: eventos da máquina (etapas, ocorrências, reinícios, falhas) de um intervalo.
// Uso:  node _diag_maquina.mjs 2026-11-12            (o dia inteiro, horário de Brasília)
//       node _diag_maquina.mjs 2026-11-12 14:00 16:30 (só esse intervalo)
// Não mostra dados de clientes: só telemetria da máquina.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const aqui = path.dirname(fileURLToPath(import.meta.url));
for (const linha of readFileSync(path.join(aqui, ".env.production"), "utf8").split(/\r?\n/)) {
  const m = /^(DATABASE_URL|DIRECT_URL)=(.*)$/.exec(linha.trim());
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { PrismaClient } = createRequire(import.meta.url)("@prisma/client");
const p = new PrismaClient();

const FUSO = 3 * 3600e3;
const [dia, hIni = "00:00", hFim = "24:00"] = process.argv.slice(2);
if (!dia) throw new Error("Informe o dia: node _diag_maquina.mjs AAAA-MM-DD [HH:MM HH:MM]");
const base = new Date(dia + "T00:00:00Z").getTime() + FUSO;
const minutos = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return (h * 60 + m) * 60e3; };
const de = new Date(base + minutos(hIni)), ate = new Date(base + minutos(hFim));
const hora = (d) => new Date(d.getTime() - FUSO).toISOString().slice(11, 19);

try {
  const ev = await p.event.findMany({
    where: {
      createdAt: { gte: de, lt: ate },
      OR: [{ type: { startsWith: "machine_" } }, { type: { in: ["car_entered", "wash_completed", "wash_failed", "x14_orphan"] } }, { type: { startsWith: "alerta" } }],
    },
    orderBy: { createdAt: "asc" }, select: { createdAt: true, type: true, payload: true },
  });
  console.log(`${dia} ${hIni}-${hFim} (Brasilia): ${ev.length} eventos\n`);
  for (const e of ev) {
    const { machineId, ...resto } = e.payload ?? {};
    console.log(`${hora(e.createdAt)}  ${e.type.padEnd(20)} ${JSON.stringify(resto).slice(0, 360)}`);
  }
} finally {
  await p.$disconnect();
}
