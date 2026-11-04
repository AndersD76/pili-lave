import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Alertas de UMA máquina (Visão geral, aba da máquina): "Abertos agora" + histórico completo com filtros de período e tipo
 * e páginas. Os alertas nunca são apagados: ficam na tabela Event (`alerta_admin` = problema, `alerta_resolvido` = "voltou").
 */

const POR_PAGINA = 50;

export const PERIODOS = [
  { k: "24h", label: "24 horas", ms: 24 * 3600e3 },
  { k: "7d", label: "7 dias", ms: 7 * 24 * 3600e3 },
  { k: "30d", label: "30 dias", ms: 30 * 24 * 3600e3 },
  { k: "tudo", label: "Tudo", ms: 0 },
];

export const TIPOS_ALERTA = [
  { k: "todos", label: "Todos" },
  { k: "CAMERA_OFFLINE", label: "Câmera fora" },
  { k: "DISPLAY_OFFLINE", label: "Display fora" },
  { k: "MAQUINA_FALHA", label: "Falha da máquina" },
  { k: "POSICAO_X15", label: "Carro não posicionou" },
  { k: "CONTADORES_DIVERGENTES", label: "Contadores diferentes" },
  { k: "voltou", label: "Só os \"voltou\"" },
];

type PayloadAlerta = { tipo?: string; mensagem?: string; machineId?: string | null };

// Só estes ficam "abertos" até um "voltou". Os demais (ex.: POSICAO_X15) são eventos pontuais e não têm "voltou".
const PERSISTENTES = ["MAQUINA_FALHA", "DISPLAY_OFFLINE", "CAMERA_OFFLINE", "CONTADORES_DIVERGENTES"];

function fmtDataHora(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export default async function AlertasMaquina({
  machineId,
  periodoK,
  tipoK,
  pagina,
  href,
}: {
  machineId: string;
  periodoK?: string;
  tipoK?: string;
  pagina: number;
  /** monta o link mantendo máquina/período/tipo: os que não forem passados ficam como estão */
  href: (over: Partial<{ periodo: string; tipo: string; pagina: number }>) => string;
}) {
  const periodo = PERIODOS.find((p) => p.k === periodoK) ?? PERIODOS[1]; // padrão: 7 dias
  const tipo = TIPOS_ALERTA.find((t) => t.k === tipoK)?.k ?? "todos";

  const and: Prisma.EventWhereInput[] = [{ payload: { path: ["machineId"], equals: machineId } }];
  if (tipo !== "todos" && tipo !== "voltou") and.push({ payload: { path: ["tipo"], equals: tipo } });
  const where: Prisma.EventWhereInput = {
    type: tipo === "voltou" ? "alerta_resolvido" : { in: ["alerta_admin", "alerta_resolvido"] },
    ...(periodo.ms ? { createdAt: { gte: new Date(Date.now() - periodo.ms) } } : {}),
    AND: and,
  };

  const [total, eventos, recentes] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({ where, orderBy: { createdAt: "desc" }, skip: (pagina - 1) * POR_PAGINA, take: POR_PAGINA }),
    // para saber o que está ABERTO agora: último evento de cada tipo, nos últimos 30 dias, desta máquina
    prisma.event.findMany({
      where: {
        type: { in: ["alerta_admin", "alerta_resolvido"] },
        createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
        payload: { path: ["machineId"], equals: machineId },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const vistos = new Set<string>();
  const abertos: { tipo: string; mensagem: string; desde: Date }[] = [];
  for (const e of recentes) {
    const p = (e.payload ?? {}) as PayloadAlerta;
    const tp = p.tipo ?? "";
    if (!PERSISTENTES.includes(tp) || vistos.has(tp)) continue;
    vistos.add(tp);
    if (e.type === "alerta_admin") abertos.push({ tipo: tp, mensagem: p.mensagem ?? "-", desde: e.createdAt });
  }

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <>
      <h3 className="section-title" style={{ marginTop: 28 }}>Abertos agora</h3>
      {abertos.length === 0 ? (
        <p style={{ opacity: 0.7 }}>Nenhum problema aberto nesta máquina.</p>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Desde</th><th>Tipo</th><th>O que aconteceu</th></tr></thead>
            <tbody>
              {abertos.map((a, i) => (
                <tr key={i}>
                  <td>{fmtDataHora(a.desde)}</td>
                  <td>{a.tipo}</td>
                  <td>{a.mensagem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="section-title" style={{ marginTop: 28 }}>Histórico de alertas</h3>
      <p style={{ opacity: 0.7, fontSize: 13, margin: "0 0 10px" }}>
        Os alertas <b>não são apagados</b>. Cada problema avisa uma vez quando começa e uma vez quando volta ao normal.
      </p>
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
        {TIPOS_ALERTA.map((t) => (
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
            <thead><tr><th>Quando</th><th>Tipo</th><th>O que aconteceu</th></tr></thead>
            <tbody>
              {eventos.map((e) => {
                const p = (e.payload ?? {}) as PayloadAlerta;
                return (
                  <tr key={e.id}>
                    <td>{fmtDataHora(e.createdAt)}</td>
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
    </>
  );
}
