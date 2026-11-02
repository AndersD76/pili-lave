import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/admin";
import { AdminNav } from "./nav";
import { HEARTBEAT_OFFLINE_S } from "@/lib/reservations";
import AlertasMaquina, { PERIODOS, TIPOS_ALERTA } from "./AlertasMaquina";

export const dynamic = "force-dynamic";

function money(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ maquina?: string; periodo?: string; tipo?: string; pagina?: string }>;
}) {
  await requireAdminPage();

  // "hoje" = meia-noite de Brasilia (UTC-3, sem horario de verao). O servidor roda em UTC: setHours(0) cortava o dia as 21h do anterior.
  const agoraBR = new Date(Date.now() - 3 * 3600e3);
  const hoje = new Date(Date.UTC(agoraBR.getUTCFullYear(), agoraBR.getUTCMonth(), agoraBR.getUTCDate(), 3, 0, 0, 0));
  const d7 = new Date(Date.now() - 7 * 864e5);
  const d30 = new Date(Date.now() - 30 * 864e5);

  const [
    vendidasHoje, vendidas7, vendidas30,
    resgatadasHoje, resgatadas30,
    recargasHoje, recargas30,
    passivo, usuarios, veiculos,
    porPrograma, ultimas,
  ] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: hoje }, status: { not: "CANCELED" } } }),
    prisma.order.count({ where: { createdAt: { gte: d7 }, status: { not: "CANCELED" } } }),
    prisma.order.count({ where: { createdAt: { gte: d30 }, status: { not: "CANCELED" } } }),
    prisma.order.count({ where: { redeemedAt: { gte: hoje } } }),
    prisma.order.count({ where: { redeemedAt: { gte: d30 } } }),
    prisma.topup.aggregate({ _sum: { amountCents: true }, where: { status: "PAID", paidAt: { gte: hoje } } }),
    prisma.topup.aggregate({ _sum: { amountCents: true }, where: { status: "PAID", paidAt: { gte: d30 } } }),
    prisma.user.aggregate({ _sum: { walletCents: true } }),
    prisma.user.count(),
    prisma.vehicle.count(),
    prisma.order.groupBy({
      by: ["programId"],
      where: { createdAt: { gte: d30 }, status: { not: "CANCELED" } },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    prisma.order.findMany({
      include: { program: true, user: true, vehicle: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  const programas = await prisma.program.findMany({ orderBy: { ordem: "asc" } });
  const progNome = (id: number) => programas.find((p) => p.id === id)?.nome ?? `#${id}`;

  // Máquinas em abas (unidade → máquina): cada uma com o seu status e o histórico de alertas (a câmera por máquina fica para depois).
  const sp = await searchParams;
  const maquinas = await prisma.machine.findMany({
    include: { station: true },
    orderBy: [{ station: { city: "asc" } }, { numero: "asc" }],
  });
  const selecionada = maquinas.find((m) => m.id === sp.maquina) ?? maquinas[0];
  const periodoAtual = PERIODOS.find((p) => p.k === sp.periodo)?.k ?? "7d";
  const tipoAtual = TIPOS_ALERTA.find((t) => t.k === sp.tipo)?.k ?? "todos";
  const paginaAtual = Math.max(1, parseInt(sp.pagina ?? "1", 10) || 1);

  const hrefMaq = (id: string, over: Partial<{ periodo: string; tipo: string; pagina: number }> = {}) => {
    const q = new URLSearchParams();
    q.set("maquina", id);
    const pe = over.periodo ?? periodoAtual;
    const ti = over.tipo ?? tipoAtual;
    if (pe !== "7d") q.set("periodo", pe);
    if (ti !== "todos") q.set("tipo", ti);
    if (over.pagina && over.pagina > 1) q.set("pagina", String(over.pagina));
    return `/admin?${q.toString()}`;
  };

  type MaquinaComUnidade = (typeof maquinas)[number];
  const estadoDe = (m: MaquinaComUnidade) => {
    const seg = m.lastHeartbeat ? Math.round((Date.now() - m.lastHeartbeat.getTime()) / 1000) : null;
    const offline = seg === null || seg > HEARTBEAT_OFFLINE_S;
    const classe: "ok" | "at" | "err" = offline || m.status === "FAULT" ? "err" : m.status === "MAINTENANCE" ? "at" : "ok";
    const rotulo = offline ? "OFFLINE" : m.status === "FAULT" ? "FALHA" : m.status === "MAINTENANCE" ? "MANUTENÇÃO" : m.status === "WASHING" ? "LAVANDO" : "OK";
    const detalhe = offline
      ? seg === null ? "nunca se comunicou" : `sem contato há ${seg}s (display)`
      : m.status === "FAULT" ? "a máquina reportou falha e parou"
      : m.status === "MAINTENANCE" ? "em manutenção"
      : m.status === "WASHING" ? `lavando · restam ${m.remainingSec}s`
      : "operando normalmente";
    return { seg, offline, classe, rotulo, detalhe };
  };

  const unidades: { stationId: string; nome: string; maquinas: MaquinaComUnidade[] }[] = [];
  for (const m of maquinas) {
    let g = unidades.find((u) => u.stationId === m.stationId);
    if (!g) { g = { stationId: m.stationId, nome: `${m.station.city} — ${m.station.address}`, maquinas: [] }; unidades.push(g); }
    g.maquinas.push(m);
  }
  const unidadeAtiva = selecionada ? unidades.find((u) => u.stationId === selecionada.stationId) : undefined;
  const est = selecionada ? estadoDe(selecionada) : null;

  return (
    <main>
      <AdminNav />

      <h2 className="section-title" style={{ marginTop: 0 }}>Máquinas</h2>
      {maquinas.length === 0 || !selecionada || !unidadeAtiva || !est ? (
        <p style={{ color: "var(--aco-d)" }}>Nenhuma máquina cadastrada ainda.</p>
      ) : (
        <>
          <div className="maq-tabs" role="tablist">
            {unidades.map((u) => {
              const ativa = u.stationId === selecionada.stationId;
              return (
                <Link
                  key={u.stationId}
                  href={hrefMaq(ativa ? selecionada.id : u.maquinas[0].id)}
                  role="tab"
                  aria-selected={ativa}
                  aria-current={ativa ? "page" : undefined}
                  className={"maq-tab" + (ativa ? " active" : "")}
                  style={{ textDecoration: "none" }}
                >
                  <span className="maq-tab-titulo">{u.nome}</span>
                  <span className="maq-tab-sub">
                    {u.maquinas.length > 1 ? `${u.maquinas.length} máquinas` : "1 máquina"}
                    {u.maquinas.map((m) => (
                      <span key={m.id} className={"maq-dot " + estadoDe(m).classe} />
                    ))}
                  </span>
                </Link>
              );
            })}
          </div>

          {unidadeAtiva.maquinas.length > 1 && (
            <div className="maq-subtabs" role="tablist">
              {unidadeAtiva.maquinas.map((m) => {
                const ativa = m.id === selecionada.id;
                return (
                  <Link
                    key={m.id}
                    href={hrefMaq(m.id)}
                    role="tab"
                    aria-selected={ativa}
                    aria-current={ativa ? "page" : undefined}
                    className={"maq-subtab" + (ativa ? " active" : "")}
                    style={{ textDecoration: "none" }}
                  >
                    Máquina {m.numero}
                    <span className={"maq-dot " + estadoDe(m).classe} />
                  </Link>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <div className="maq-painel">
              <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 14 }}>
                {unidadeAtiva.nome} — Máquina {selecionada.numero}
              </h3>
              <div className="stats">
                <div className={`stat${est.classe === "ok" ? "" : " alerta"}`}>
                  <div className="lab">Máquina</div>
                  <div className="val">{est.rotulo}</div>
                  <div className="sub">{est.detalhe}</div>
                </div>
                <div className={`stat${est.seg !== null && est.seg <= HEARTBEAT_OFFLINE_S ? "" : " alerta"}`}>
                  <div className="lab">Display</div>
                  <div className="val">{est.seg === null ? "—" : `${est.seg}s`}</div>
                  <div className="sub">desde o último contato</div>
                </div>
              </div>
              <p style={{ opacity: 0.6, fontSize: 12, margin: "10px 0 0" }}>
                O estado da câmera por máquina entra numa próxima etapa (hoje as fotos não são separadas por máquina).
              </p>

              <AlertasMaquina
                machineId={selecionada.id}
                periodoK={periodoAtual}
                tipoK={tipoAtual}
                pagina={paginaAtual}
                href={(over) => hrefMaq(selecionada.id, over)}
              />
            </div>
          </div>
        </>
      )}

      <h2 className="section-title" style={{ marginTop: 40 }}>Resumo do negócio</h2>

      <div className="stats">
        <div className="stat"><div className="lab">Lavagens hoje</div><div className="val">{vendidasHoje}</div><div className="sub">{vendidas7} em 7 dias · {vendidas30} em 30</div></div>
        <div className="stat"><div className="lab">Resgates hoje</div><div className="val">{resgatadasHoje}</div><div className="sub">{resgatadas30} em 30 dias</div></div>
        <div className="stat"><div className="lab">Recargas hoje</div><div className="val">{money(recargasHoje._sum.amountCents ?? 0)}</div><div className="sub">{money(recargas30._sum.amountCents ?? 0)} em 30 dias</div></div>
        <div className="stat alerta"><div className="lab">Saldo em carteiras</div><div className="val">{money(passivo._sum.walletCents ?? 0)}</div><div className="sub">passivo — dinheiro dos clientes</div></div>
        <div className="stat"><div className="lab">Clientes</div><div className="val">{usuarios}</div><div className="sub">{veiculos} veículos</div></div>
      </div>

      <h2 className="section-title">Vendas por tipo — 30 dias</h2>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Programa</th><th>Lavagens</th><th>Receita</th></tr></thead>
          <tbody>
            {porPrograma.map((g) => (
              <tr key={g.programId}>
                <td>{g.programId} · {progNome(g.programId)}</td>
                <td>{g._count._all}</td>
                <td>{money(g._sum.amountCents ?? 0)}</td>
              </tr>
            ))}
            {porPrograma.length === 0 && <tr><td colSpan={3} style={{ color: "var(--aco-d)" }}>Sem vendas ainda.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">Últimas lavagens</h2>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Quando</th><th>Cliente</th><th>Placa</th><th>Programa</th><th>Valor</th><th>Status</th></tr></thead>
          <tbody>
            {ultimas.map((o) => (
              <tr key={o.id}>
                <td>{o.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td>{o.user.name ?? o.user.phone}</td>
                <td>{o.vehicle?.plate ?? "—"}</td>
                <td>{o.program.nome}</td>
                <td>{money(o.amountCents)}</td>
                <td>
                  {o.status === "PAID" && <span className="chip at">Aguardando resgate</span>}
                  {o.status === "REDEEMED" && <span className="chip ok">Liberada</span>}
                  {o.status === "CANCELED" && <span className="chip err">Cancelada</span>}
                </td>
              </tr>
            ))}
            {ultimas.length === 0 && <tr><td colSpan={6} style={{ color: "var(--aco-d)" }}>Nada por aqui ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
