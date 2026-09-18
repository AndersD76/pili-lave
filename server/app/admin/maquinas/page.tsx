import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/admin";
import { AdminNav } from "../nav";
import MaquinasTabs from "./MaquinasTabs";

export const dynamic = "force-dynamic";

const LIC_AVISO_DIAS = 40;
const LIC_BLOQUEIO_DIAS = 50;
const HEARTBEAT_OFFLINE_S = 60;
const HISTORICO_LIMITE = 30;

function diasDesde(d: Date | null): number {
  if (!d) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function fmtQuando(d: Date | null): string {
  if (!d) return "nunca";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.floor(s / 60)}min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)}h`;
  return `há ${Math.floor(s / 86400)}d`;
}

function fmtData(d: Date): string {
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function money(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

function licencaDe(lastPaymentDate: Date | null): { label: string; classe: "ok" | "at" | "off" | "err" } {
  if (!lastPaymentDate) return { label: "sem registro", classe: "off" };
  const dias = diasDesde(lastPaymentDate);
  if (dias >= LIC_BLOQUEIO_DIAS) return { label: `BLOQUEADA (${dias}d)`, classe: "err" };
  if (dias >= LIC_AVISO_DIAS) return { label: `aviso (${dias}d)`, classe: "at" };
  return { label: `em dia (${dias}d)`, classe: "ok" };
}

export default async function AdminMaquinas() {
  await requireAdminPage();
  const [machines, lavadores] = await Promise.all([
    prisma.machine.findMany({
      include: { station: true, operador: true },
      orderBy: [{ station: { city: "asc" } }, { numero: "asc" }],
    }),
    prisma.user.findMany({
      where: { role: "LAVADOR" },
      select: { id: true, name: true, phone: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const historicos = await Promise.all(
    machines.map((m) =>
      prisma.reservation.findMany({
        where: { machineId: m.id, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        take: HISTORICO_LIMITE,
        include: { user: true, program: true },
      })
    )
  );

  const offlineCount = machines.filter(
    (m) => !m.lastHeartbeat || Date.now() - m.lastHeartbeat.getTime() > HEARTBEAT_OFFLINE_S * 1000
  ).length;
  const manutencaoCount = machines.filter((m) => m.status === "MAINTENANCE").length;
  const bloqueadasCount = machines.filter((m) => licencaDe(m.lastPaymentDate).classe === "err").length;

  const maquinasProps = machines.map((m, i) => {
    const offline = !m.lastHeartbeat || Date.now() - m.lastHeartbeat.getTime() > HEARTBEAT_OFFLINE_S * 1000;
    return {
      id: m.id,
      numero: m.numero,
      unidade: `${m.station.city} — ${m.station.address}`,
      status: m.status,
      offline,
      emManutencao: m.status === "MAINTENANCE",
      ultimaBatida: fmtQuando(m.lastHeartbeat),
      sensores: `X14:${m.sensorX14 ? "1" : "0"} X15:${m.sensorX15 ? "1" : "0"} · ${m.remainingSec}s restante`,
      licenca: licencaDe(m.lastPaymentDate),
      operadorId: m.operadorId,
      historico: historicos[i].map((r) => ({
        id: r.id,
        quando: r.completedAt ? fmtData(r.completedAt) : "—",
        programa: r.program.nome,
        valor: money(r.amountCents),
        cliente: r.user.name ?? r.user.phone,
      })),
    };
  });

  const lavadoresProps = lavadores.map((l) => ({ id: l.id, label: l.name ?? l.phone }));

  return (
    <main className="admin-wrap">
      <AdminNav />
      <h2 className="section-title" style={{ marginTop: 0 }}>Máquinas</h2>

      <div className="stats">
        <div className="stat">
          <div className="lab">Total de máquinas</div>
          <div className="val">{machines.length}</div>
        </div>
        <div className={"stat" + (offlineCount > 0 ? " alerta" : "")}>
          <div className="lab">Offline agora</div>
          <div className="val">{offlineCount}</div>
        </div>
        <div className={"stat" + (manutencaoCount > 0 ? " alerta" : "")}>
          <div className="lab">Em manutenção</div>
          <div className="val">{manutencaoCount}</div>
        </div>
        <div className={"stat" + (bloqueadasCount > 0 ? " alerta" : "")}>
          <div className="lab">Licença bloqueada</div>
          <div className="val">{bloqueadasCount}</div>
        </div>
      </div>

      <div style={{ marginTop: 30 }}>
        <MaquinasTabs maquinas={maquinasProps} lavadores={lavadoresProps} />
      </div>
    </main>
  );
}
