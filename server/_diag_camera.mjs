// SÓ LEITURA no banco de PRODUÇÃO: diagnóstico da câmera (camera_diag) e alertas de um dia.
// Uso:  node server/_diag_camera.mjs [AAAA-MM-DD]      (sem data = ontem e hoje)
// Não mostra dados de clientes: só telemetria da câmera, alertas e horários de lavagem.
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
const dia = process.argv[2];
const de = dia ? new Date(new Date(dia + "T00:00:00Z").getTime() + FUSO) : new Date(Date.now() - 36 * 3600e3);
const ate = dia ? new Date(de.getTime() + 24 * 3600e3) : new Date();
const hora = (d) => new Date(d.getTime() - FUSO).toISOString().slice(5, 19).replace("T", " ");
const RST = { 0: "desconhecido", 1: "ENERGIZOU", 2: "pino/externo", 3: "software", 4: "PANICO", 5: "watchdog-int", 6: "WATCHDOG", 7: "watchdog", 8: "deep-sleep", 9: "QUEDA-DE-TENSAO", 10: "sdio" };

try {
  const tipos = await p.event.groupBy({ by: ["type"], where: { createdAt: { gte: de, lt: ate } }, _count: true });
  console.log(`Periodo: ${hora(de)} a ${hora(ate)} (horario de Brasilia)`);
  console.log("Tipos de evento no periodo:", tipos.map((t) => `${t.type}=${t._count}`).join(", "));

  const ev = await p.event.findMany({
    where: { createdAt: { gte: de, lt: ate }, OR: [{ type: "camera_diag" }, { type: { startsWith: "alerta" } }, { type: { in: ["car_entered", "wash_completed", "wash_failed", "machine_fault", "reset_log"] } }] },
    orderBy: { createdAt: "asc" }, select: { createdAt: true, type: true, payload: true },
  });
  const diag = ev.filter((e) => e.type === "camera_diag");
  console.log(`\nRelatorios da camera (camera_diag): ${diag.length}` + (diag.length ? ` | firmware v${diag.at(-1).payload.fw}` : "  <-- NENHUM: a camera nao esta na v8 ou nao conseguiu enviar"));
  console.log("\nLINHA DO TEMPO");
  console.log("legenda da camera: ligada=tempo desde o ultimo reinicio | sinal min/med/max (dBm) | bloco=maior bloco de memoria livre (minimo na janela)");
  console.log("                   fotos ok/falha (seg=falhas seguidas, cod=ultimo erro) | hb=heartbeat ok/falha | quedas de Wi-Fi (maior tempo fora) | sensor=falhas de captura\n");
  let upAnterior = null;
  for (const e of ev) {
    const d = e.payload ?? {};
    if (e.type === "camera_diag") {
      const reiniciou = upAnterior !== null && d.up < upAnterior;
      upAnterior = d.up;
      const lig = d.up >= 3600 ? `${(d.up / 3600).toFixed(1)}h` : `${Math.round(d.up / 60)}min`;
      console.log(
        `${hora(e.createdAt)}  CAM ` + (reiniciou || d.up < 400 ? `*** REINICIOU (${RST[d.rst] ?? d.rst}) *** ` : "") +
        `ligada ${lig} | sinal ${d.rssiMin}/${d.rssiMed}/${d.rssiMax} ch${d.ch} | bloco ${Math.round(d.blocoMin / 1024)}KB heap ${Math.round(d.heapMin / 1024)}KB | ` +
        `fotos ${d.fOk}/${d.fFalha}` + (d.fFalha ? ` (seg ${d.fSeg}, cod ${d.fCode})` : "") + ` | hb ${d.hbOk}/${d.hbFalha}` + (d.hbFalha ? ` (cod ${d.hbCode})` : "") +
        ` | quedas ${d.quedas}` + (d.quedas ? ` (max ${d.descMaxS}s, buscas ${d.scans})` : "") + (d.fbFalhas ? ` | SENSOR ${d.fbFalhas}` : "") +
        (d.kbMed !== undefined ? ` | foto ${d.kbMed}KB (max ${d.kbMax}) envio ${d.tOk}ms (max ${d.tOkMax})` + (d.fFalha ? ` falha apos ${d.tFal}ms` : "") + ` | ${d.temp}C tx ${d.txp}dBm q${d.q}` + (d.fRed ? ` reduzidas ${d.fRed}` : "") : "") +
        ` | janela ${d.janelaS}s`
      );
    } else if (e.type.startsWith("alerta")) {
      console.log(`${hora(e.createdAt)}  >>> ${e.type === "alerta_resolvido" ? "VOLTOU " : "ALERTA "} ${d.tipo ?? ""}: ${String(d.mensagem ?? "").slice(0, 110)}`);
    } else {
      console.log(`${hora(e.createdAt)}  ... ${e.type}` + (d.motivo || d.errorCode ? ` (${d.motivo ?? d.errorCode})` : ""));
    }
  }

  if (diag.length) {
    const s = (f) => diag.reduce((a, e) => a + (Number(e.payload[f]) || 0), 0);
    const min = (f) => Math.min(...diag.map((e) => Number(e.payload[f])).filter((v) => Number.isFinite(v) && v !== 0));
    const cods = {};
    for (const e of diag) if (e.payload.fFalha) cods[e.payload.fCode] = (cods[e.payload.fCode] ?? 0) + 1;
    console.log("\nRESUMO DO PERIODO");
    console.log(`  fotos: ${s("fOk")} ok, ${s("fFalha")} com falha (${((100 * s("fFalha")) / Math.max(1, s("fOk") + s("fFalha"))).toFixed(1)}%) | codigos de erro (janelas): ${JSON.stringify(cods)}`);
    console.log(`  heartbeat: ${s("hbOk")} ok, ${s("hbFalha")} com falha`);
    console.log(`  quedas de Wi-Fi: ${s("quedas")} | maior tempo fora: ${Math.max(...diag.map((e) => e.payload.descMaxS))}s | buscas de rede: ${s("scans")}`);
    console.log(`  pior sinal: ${min("rssiMin")} dBm | menor bloco de memoria: ${Math.round(min("blocoMin") / 1024)} KB | falhas do sensor: ${s("fbFalhas")}`);
    console.log(`  reinicios vistos: ${diag.filter((e, i) => e.payload.up < 400 || (i > 0 && e.payload.up < diag[i - 1].payload.up)).map((e) => `${hora(e.createdAt)} ${RST[e.payload.rst] ?? e.payload.rst}`).join("; ") || "nenhum"}`);
  }
} finally {
  await p.$disconnect();
}
