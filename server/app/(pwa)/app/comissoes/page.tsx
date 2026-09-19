"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, money } from "../client";
import { Nav } from "../nav";
import { Logo } from "../Logo";

const STATUS_LABEL: Record<string, string> = {
  FREE: "Livre", WASHING: "Lavando", FAULT: "Em operação", OFFLINE: "Em operação", MAINTENANCE: "Em manutenção",
};
const NOME_TIPO: Record<number, string> = { 1: "Tipo 1", 2: "Tipo 2", 3: "Tipo 3", 4: "Tipo 4" };

type Coluna = { lavagens: number; valorCents: number };
type TipoLavagem = { programId: number; app: Coluna; presencial: Coluna };
type Maquina = {
  id: string; numero: number;
  unidade: { cidade: string; rua: string };
  tipo: string; tipoLabel: string; status: string;
  totalGeralCents: number; suaParticipacaoCents: number;
  porTipo: TipoLavagem[];
};

type Modo = "hoje" | "periodo" | "acerto";

function paraISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Painel do parceiro (Comissão 1/2, Aluguel) — equivalente ao mobile
 * minhas-comissoes.tsx, mas no PWA. Sem status/falha em destaque: o
 * parceiro só acompanha o relatório financeiro das próprias máquinas.
 */
export default function Comissoes() {
  const router = useRouter();
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modo, setModo] = useState<Modo>("hoje");
  const [de, setDe] = useState(paraISO(new Date()));
  const [ate, setAte] = useState(paraISO(new Date()));
  const [error, setError] = useState("");

  function carregar(m: Modo, deVal: string, ateVal: string) {
    let qs = "";
    if (m === "acerto") qs = "?desde=acerto";
    else if (m === "periodo") qs = `?de=${deVal}&ate=${ateVal}`;
    api<{ maquinas: Maquina[] }>(`/api/parceiro/painel${qs}`)
      .then((r) => { setMaquinas(r.maquinas); setLoaded(true); })
      .catch((e) => {
        if (e?.status === 401) router.replace("/app/login");
        else setError("Não foi possível carregar.");
      });
  }
  useEffect(() => { carregar("hoje", de, ate); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Logo />
      <h1>Minhas Comissões</h1>

      <div className="abas">
        <button className={modo === "hoje" ? "on" : ""} onClick={() => { setModo("hoje"); carregar("hoje", de, ate); }}>Hoje</button>
        <button className={modo === "periodo" ? "on" : ""} onClick={() => setModo("periodo")}>Período</button>
        <button className={modo === "acerto" ? "on" : ""} onClick={() => { setModo("acerto"); carregar("acerto", de, ate); }}>Não acertado</button>
      </div>

      {modo === "periodo" && (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="sub" style={{ display: "block" }}>
            De
            <input className="field" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </label>
          <label className="sub" style={{ display: "block" }}>
            Até
            <input className="field" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </label>
          <button className="btn" onClick={() => carregar("periodo", de, ate)}>Ver</button>
        </div>
      )}

      {error && <p className="err">{error}</p>}
      {loaded && maquinas.length === 0 && <p className="sub">Nenhuma máquina vinculada ao seu usuário ainda. Fale com o administrador.</p>}

      {maquinas.map((m) => (
        <div className="card" key={m.id}>
          <div className="lab">{m.unidade.cidade} — {m.unidade.rua} · Máquina {m.numero}</div>
          <span className="chip ok">{STATUS_LABEL[m.status] ?? m.status}</span>
          <span className="sub" style={{ marginLeft: 8 }}>{m.tipoLabel}</span>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
            <span className="sub">Total no período</span>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20 }}>{money(m.totalGeralCents)}</span>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", padding: "6px 0", borderBottom: "1px solid var(--linha)", fontSize: 11, fontWeight: 700, color: "var(--aco-d)" }}>
              <span style={{ flex: 1 }}>TIPO</span>
              <span style={{ flex: 1, textAlign: "right" }}>PRESENCIAL</span>
              <span style={{ flex: 1, textAlign: "right" }}>APP</span>
            </div>
            {m.porTipo.map((t) => (
              <div key={t.programId} style={{ display: "flex", padding: "8px 0", alignItems: "center" }}>
                <span style={{ flex: 1, fontSize: 14 }}>{NOME_TIPO[t.programId]}</span>
                <span style={{ flex: 1, textAlign: "right" }}>
                  <div className="sub" style={{ fontSize: 12 }}>{t.presencial.lavagens}x</div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{money(t.presencial.valorCents)}</div>
                </span>
                <span style={{ flex: 1, textAlign: "right" }}>
                  <div className="sub" style={{ fontSize: 12 }}>{t.app.lavagens}x</div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{money(t.app.valorCents)}</div>
                </span>
              </div>
            ))}
          </div>

          <div style={{ height: 1, background: "var(--linha)", margin: "12px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Sua participação</span>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22, color: "var(--ok)" }}>{money(m.suaParticipacaoCents)}</span>
          </div>
        </div>
      ))}

      <Nav />
    </>
  );
}
