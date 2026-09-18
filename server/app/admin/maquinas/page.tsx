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

async function definirOperador(formData: FormData) {
  "use server";
  if (!(await isAdmin())) return;
  const id = String(formData.get("id"));
  const operadorId = String(formData.get("operadorId") || "");
  await prisma.machine.update({ where: { id }, data: { operadorId: operadorId || null } });
  revalidatePath("/admin/maquinas");
}

export default async function AdminMaquinas() {
  await requireAdminPage();
  const machines = await prisma.machine.findMany({
    include: { station: true, operador: true },
    orderBy: [{ station: { city: "asc" } }, { numero: "asc" }],
  });
  const lavadores = await prisma.user.findMany({
    where: { role: "LAVADOR" },
    select: { id: true, name: true, phone: true },
    orderBy: { name: "asc" },
  });

  return (
    <main>
      <AdminNav />
      <h2 className="section-title">Máquinas — pagamento, licença e diagnóstico</h2>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Unidade</th><th>Nº</th><th>Status</th><th>Última batida</th>
              <th>Sensores</th><th>Licença</th><th>Lavador</th><th>Ações</th>
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
                  <td>{m.station.city} — {m.station.address}</td>
                  <td>{m.numero}</td>
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
                  <td>
                    <form action={definirOperador} style={{ display: "flex", gap: 6 }}>
                      <input type="hidden" name="id" value={m.id} />
                      <select
                        name="operadorId"
                        defaultValue={m.operadorId ?? ""}
                        className="field"
                        style={{ height: 32, fontSize: 12, padding: "0 6px" }}
                      >
                        <option value="">— sem lavador —</option>
                        {lavadores.map((l) => (
                          <option key={l.id} value={l.id}>{l.name ?? l.phone}</option>
                        ))}
                      </select>
                      <button className="btn ghost" type="submit" style={{ height: 32, padding: "0 10px", fontSize: 12 }}>
                        Salvar
                      </button>
                    </form>
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
