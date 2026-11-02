import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/admin";
import { AdminNav } from "../nav";

export const dynamic = "force-dynamic";

/**
 * Histórico de alertas (2026-11-02). Os alertas nunca são apagados: ficam na tabela Event
 * (`alerta_admin` = problema, `alerta_resolvido` = "voltou"). Esta página mostra tudo, com abas por MÁQUINA,
 * período, tipo e páginas, e lista no topo o que está ABERTO agora.
 */

const POR_PAGINA = 50;

const PERIODOS = [
  { k: "24h", label: "24 horas", ms: 24 * 3600e3 },
  { k: "7d", label: "7 dias", ms: 7 * 24 * 3600e3 },
  { k: "30d", label: "30 dias", ms: 30 * 24 * 3600e3 },
  { k: "tudo", label: "Tudo", ms: 0 },
];

const TIPOS = [
  { k: "todos", label: "Todos" },
  { k: "CAMERA_OFFLINE", label: "Câmera fora" },
  { k: "DISPLAY_OFFLINE", label: "Display fora" },
  { k: "MAQUINA_FALHA", label: "Falha da máquina" },
  { k: "POSICAO_X15", label: "Carro não posicionou" },
  { k: "voltou", label: "Só os \"voltou\"" },
];

type PayloadAlerta = { tipo?: string; mensagem?: string; machineId?: string | null };

// Só estes ficam "abertos" até um "voltou". Os demais (ex.: POSICAO_X15) são eventos pontuais e não têm "voltou".
const PERSISTENTES = ["MAQUINA_FALHA", "DISPLAY_OFFLINE", "CAMERA_OFFLINE"];

function fmtDataHora(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export default async function AdminAlertas({
  searchParams,
}: {
  searchParams: Promise<{ maquina?: string; periodo?: string; tipo?: string; pagina?: string }>;
}) {
  await requireAdminPage();
  const sp = await searchParams;

  const maquinaId = sp.maquina && sp.maquina !== "todas" ? sp.maquina : null;
  const periodo = PERIODOS.find((p) => p.k === sp.periodo) ?? PERIODOS[1]; // padrão: 7 dias
  const tipo = TIPOS.find((t) => t.k === sp.tipo)?.k ?? "todos";
  const pagina = Math.max(1, parseInt(sp.pagina ?? "1", 10) || 1);

  const href = (over: Partial<{ maquina: string; periodo: string; tipo: string; pagina: number }>) => {
    const q = new URLSearchParams();
    const m = over.maquina ?? maquinaId ?? "todas";
    const pe = over.periodo ?? periodo.k;
    const ti = over.tipo ?? tipo;
    if (m !== "todas") q.set("maquina", m);
    if (pe !== "7d") q.set("periodo", pe);
    if (ti !== "todos") q.set("tipo", ti);
    if (over.pagina && over.pagina > 1) q.set("pagina", String(over.pagina));
    const s = q.toString();
    return s ? `/admin/alertas?${s}` : "/admin/alertas";
  };

  const desde = periodo.ms ? new Date(Date.now() - periodo.ms) : new Date(0);
  const and: Prisma.EventWhereInput[] = [];
  if (maquinaId) and.push({ payload: { path: ["machineId"], equals: maquinaId } });
  if (tipo !== "todos" && tipo !== "voltou") and.push({ payload: { path: ["tipo"], equals: tipo } });
  const where: Prisma.EventWhereInput = {
    type: tipo === "voltou" ? "alerta_resolvido" : { in: ["alerta_admin", "alerta_resolvido"] },
    ...(periodo.ms ? { createdAt: { gte: desde } } : {}),
    AND: and,
  };

  const [machines, total, eventos, contagens, recentes] = await Promise.all([
    prisma.machine.findMany({ include: { station: true }, orderBy: [{ station: { city: "asc" } }, { numero: "asc" }] }),
    prisma.event.count({ where }),
    prisma.event.findMany({ where, orderBy: { createdAt: "desc" }, skip: (pagina - 1) * POR_PAGINA, take: POR_PAGINA }),
    // quantos alertas por máquina no período (sem o filtro de máquina/tipo): números das abas
    prisma.$queryRaw<{ m: string | null; n: bigint }[]>`
      SELECT payload->>'machineId' AS m, COUNT(*) AS n FROM "Event"
      WHERE type IN ('alerta_admin', 'alerta_resolvido') AND "createdAt" >= ${desde}
      GROUP BY 1`,
    // para saber o que está ABERTO agora: último evento de cada tipo+máquina nos últimos 30 dias
    prisma.event.findMany({
      where: { type: { in: ["alerta_admin", "alerta_resolvido"] }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);

  const nomeMaquina = new Map(machines.map((m) => [m.id, `${m.station.city} — máq. ${m.numero}`]));
  const nomeDe = (id: string | null | undefined) => (id ? nomeMaquina.get(id) ?? "máquina removida" : "—");
  const contPorMaquina = new Map(contagens.map((c) => [c.m ?? "", Number(c.n)]));
  const totalGeral = contagens.reduce((s, c) => s + Number(c.n), 0);

  // abertos agora: o 1º (mais novo) evento de cada tipo+máquina, se for "alerta_admin"
  const vistos = new Set<string>();
  const abertos: { tipo: string; machineId: string | null; mensagem: string; desde: Date }[] = [];
  for (const e of recentes) {
    const p = (e.payload ?? {}) as PayloadAlerta;
    const chave = `${p.tipo}|${p.machineId ?? ""}`;
    if (!PERSISTENTES.includes(p.tipo ?? "") || vistos.has(chave)) continue;
    vistos.add(chave);
    if (e.type === "alerta_admin") abertos.push({ tipo: p.tipo ?? "-", machineId: p.machineId ?? null, mensagem: p.mensagem ?? "-", desde: e.createdAt });
  }
  const abertosVisiveis = abertos.filter((a) => !maquinaId || a.machineId === maquinaId);
  const maquinasComAberto = new Set(abertos.map((a) => a.machineId ?? ""));

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <main className="admin-wrap">
      <AdminNav />
      <h2 className="section-title" style={{ marginTop: 0 }}>Alertas</h2>
      <p style={{ opacity: 0.7, fontSize: 13, margin: "0 0 14px" }}>
        Os alertas <b>não são apagados</b>: ficam guardados e aparecem aqui. Cada problema avisa uma vez quando começa e uma vez quando volta ao normal.
      </p>

      <div className="maq-tabs" role="tablist">
        <Link href={href({ maquina: "todas", pagina: 1 })} className={"maq-tab" + (!maquinaId ? " active" : "")} style={{ textDecoration: "none" }}>
          <span className="maq-tab-titulo">Todas as máquinas</span>
          <span className="maq-tab-sub">{totalGeral} no período</span>
        </Link>
        {machines.map((m) => (
          <Link
            key={m.id}
            href={href({ maquina: m.id, pagina: 1 })}
            className={"maq-tab" + (maquinaId === m.id ? " active" : "")}
            style={{ textDecoration: "none" }}
          >
            <span className="maq-tab-titulo">{m.station.city} — máq. {m.numero}</span>
            <span className="maq-tab-sub">
              <span className={"maq-dot " + (maquinasComAberto.has(m.id) ? "err" : "ok")} />
              {contPorMaquina.get(m.id) ?? 0} no período{maquinasComAberto.has(m.id) ? " · aberto" : ""}
            </span>
          </Link>
        ))}
      </div>

      <h3 className="section-title" style={{ marginTop: 28 }}>Abertos agora</h3>
      {abertosVisiveis.length === 0 ? (
        <p style={{ opacity: 0.7 }}>Nenhum problema aberto{maquinaId ? " nesta máquina" : ""}.</p>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Desde</th><th>Máquina</th><th>Tipo</th><th>O que aconteceu</th></tr></thead>
            <tbody>
              {abertosVisiveis.map((a, i) => (
                <tr key={i}>
                  <td>{fmtDataHora(a.desde)}</td>
                  <td>{nomeDe(a.machineId)}</td>
                  <td>{a.tipo}</td>
                  <td>{a.mensagem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="section-title" style={{ marginTop: 28 }}>Histórico</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "0 0 8px" }}>
        <span style={{ opacity: 0.7, fontSize: 13 }}>Período:</span>
        {PERIODOS.map((p) => (
          <Link key={p.k} href={href({ periodo: p.k, pagina: 1 })} className={"chip" + (periodo.k === p.k ? " ok" : " off")} style={{ textDecoration: "none" }}>
            {p.label}
          </Link>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "0 0 14px" }}>
        <span style={{ opacity: 0.7, fontSize: 13 }}>Tipo:</span>
        {TIPOS.map((t) => (
          <Link key={t.k} href={href({ tipo: t.k, pagina: 1 })} className={"chip" + (tipo === t.k ? " ok" : " off")} style={{ textDecoration: "none" }}>
            {t.label}
          </Link>
        ))}
      </div>

      {eventos.length === 0 ? (
        <p style={{ opacity: 0.7 }}>Nenhum alerta neste filtro.</p>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Quando</th><th>Máquina</th><th>Tipo</th><th>O que aconteceu</th></tr></thead>
            <tbody>
              {eventos.map((e) => {
                const p = (e.payload ?? {}) as PayloadAlerta;
                return (
                  <tr key={e.id}>
                    <td>{fmtDataHora(e.createdAt)}</td>
                    <td>{nomeDe(p.machineId)}</td>
                    <td>{p.tipo ?? "-"}{e.type === "alerta_resolvido" ? " ✓ voltou" : ""}</td>
                    <td>{p.mensagem ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "16px 0", flexWrap: "wrap" }}>
        <span style={{ opacity: 0.7, fontSize: 13 }}>
          {total} alerta(s) · página {Math.min(pagina, paginas)} de {paginas}
        </span>
        {pagina > 1 && <Link href={href({ pagina: pagina - 1 })} className="chip off" style={{ textDecoration: "none" }}>← mais novos</Link>}
        {pagina < paginas && <Link href={href({ pagina: pagina + 1 })} className="chip off" style={{ textDecoration: "none" }}>mais antigos →</Link>}
      </div>
    </main>
  );
}
