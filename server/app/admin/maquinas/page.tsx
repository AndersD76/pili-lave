import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isAdmin, requireAdminPage } from "@/lib/admin";
import { AdminNav } from "../nav";

export const dynamic = "force-dynamic";

const LIC_AVISO_DIAS = 40;
const LIC_BLOQUEIO_DIAS = 50;
const HEARTBEAT_OFFLINE_S = 60;

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

async function marcarPagamento(formData: FormData) {
  "use server";
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  await prisma.machine.update({ where: { id }, data: { lastPaymentDate: new Date() } });
  revalidatePath("/admin/maquinas");
}

async function alternarManutencao(formData: FormData) {
  "use server";
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  const machine = await prisma.machine.findUnique({ where: { id } });
  if (!machine) return;
  await prisma.machine.update({
    where: { id },
    data: { status: machine.status === "MAINTENANCE" ? "OFFLINE" : "MAINTENANCE" },
  });
  revalidatePath("/admin/maquinas");
}

export default async function AdminMaquinas() {
  await requireAdminPage();
  const machines = await prisma.machine.findMany({
    include: { station: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main>
      <AdminNav />
      <h2 className="section-title">Máquinas — pagamento, licença e diagnóstico</h2>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Máquina</th><th>Unidade</th><th>Status</th><th>Última batida</th>
              <th>Sensores</th><th>Licença</th><th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {machines.map((m) => {
              const offline = !m.lastHeartbeat ||
                Date.now() - m.lastHeartbeat.getTime() > HEARTBEAT_OFFLINE_S * 1000;
              const dias = diasDesde(m.lastPaymentDate);
              const bloqueada = !!m.lastPaymentDate && dias >= LIC_BLOQUEIO_DIAS;
              const avisando = !bloqueada && !!m.lastPaymentDate && dias >= LIC_AVISO_DIAS;
              return (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.station.name}</td>
                  <td>
                    <span className={offline ? "chip err" : m.status === "MAINTENANCE" ? "chip at" : "chip ok"}>
                      {offline ? "OFFLINE" : m.status}
                    </span>
                  </td>
                  <td>{fmtQuando(m.lastHeartbeat)}</td>
                  <td>
                    X14:{m.sensorX14 ? "1" : "0"} X15:{m.sensorX15 ? "1" : "0"}
                    {" · "}{m.remainingSec}s restante
                  </td>
                  <td>
                    {!m.lastPaymentDate ? (
                      <span className="chip off">sem registro</span>
                    ) : bloqueada ? (
                      <span className="chip err">BLOQUEADA ({dias}d)</span>
                    ) : avisando ? (
                      <span className="chip at">aviso ({dias}d)</span>
                    ) : (
                      <span className="chip ok">em dia ({dias}d)</span>
                    )}
                  </td>
                  <td style={{ display: "flex", gap: 8 }}>
                    <form action={marcarPagamento}>
                      <input type="hidden" name="id" value={m.id} />
                      <button className="btn ghost" type="submit">Marcar pago hoje</button>
                    </form>
                    <form action={alternarManutencao}>
                      <input type="hidden" name="id" value={m.id} />
                      <button className="btn ghost" type="submit">
                        {m.status === "MAINTENANCE" ? "Tirar de manutenção" : "Pôr em manutenção"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
