"use client";

import { useState } from "react";
import { marcarPagamento, alternarManutencao, definirOperador } from "./actions";

type Lavagem = {
  id: string;
  quando: string;
  programa: string;
  valor: string;
  cliente: string;
};

type Maquina = {
  id: string;
  numero: number;
  stationId: string;
  unidade: string;
  status: string;
  offline: boolean;
  emManutencao: boolean;
  ultimaBatida: string;
  sensores: string;
  licenca: { label: string; classe: "ok" | "at" | "off" | "err" };
  operadorId: string | null;
  valorDesdeFechamento: string;
  historico: Lavagem[];
};

type Lavador = { id: string; label: string };
type Totais = {
  valorTotalGeral: string;
  porPrograma: { programa: string; qtd: number; valor: string }[];
};

const TAB_TOTAIS = "__totais__";

function PainelMaquina({ m, lavadores }: { m: Maquina; lavadores: Lavador[] }) {
  return (
    <div className="maq-painel">
      <div className="maq-painel-topo">
        <div>
          <h3 style={{ fontSize: 20, fontWeight: 800 }}>
            {m.unidade} — Máquina {m.numero}
          </h3>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <span className={"chip " + (m.offline ? "err" : m.emManutencao ? "at" : "ok")}>
              {m.offline ? "OFFLINE" : m.status}
            </span>
            <span className={"chip " + m.licenca.classe}>{m.licenca.label}</span>
          </div>
          <p style={{ color: "var(--aco-d)", fontSize: 13, marginTop: 8 }}>
            Última batida: {m.ultimaBatida} · {m.sensores}
          </p>
        </div>

        <div style={{ textAlign: "right" }}>
          <div className="lab" style={{ fontSize: 11 }}>Desde o último fechamento</div>
          <div className="val" style={{ fontSize: 26 }}>{m.valorDesdeFechamento}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        <form action={marcarPagamento}>
          <input type="hidden" name="id" value={m.id} />
          <button className="btn ghost" type="submit">Marcar pago hoje (fechar valores)</button>
        </form>
        <form action={alternarManutencao}>
          <input type="hidden" name="id" value={m.id} />
          <button className="btn ghost" type="submit">
            {m.emManutencao ? "Tirar de manutenção" : "Pôr em manutenção"}
          </button>
        </form>
      </div>

      <form action={definirOperador} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 18 }}>
        <input type="hidden" name="id" value={m.id} />
        <label style={{ fontSize: 13, color: "var(--aco-d)" }}>Lavador responsável:</label>
        <select name="operadorId" defaultValue={m.operadorId ?? ""} className="field" style={{ width: 240, height: 36, fontSize: 13, padding: "0 10px" }}>
          <option value="">— sem lavador —</option>
          {lavadores.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
        <button className="btn ghost" type="submit" style={{ height: 36 }}>Salvar</button>
      </form>

      <h4 className="section-title" style={{ margin: "26px 0 10px" }}>
        Histórico de lavagens (sem acerto financeiro ainda)
      </h4>
      {m.historico.length === 0 ? (
        <p style={{ color: "var(--aco-d)", fontSize: 14 }}>Nenhuma lavagem concluída ainda nesta máquina.</p>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Quando</th><th>Cliente</th><th>Programa</th><th>Valor</th>
              </tr>
            </thead>
            <tbody>
              {m.historico.map((h) => (
                <tr key={h.id}>
                  <td>{h.quando}</td>
                  <td>{h.cliente}</td>
                  <td>{h.programa}</td>
                  <td>{h.valor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MaquinasTabs({
  maquinas,
  lavadores,
  totais,
}: {
  maquinas: Maquina[];
  lavadores: Lavador[];
  totais: Totais;
}) {
  // Agrupa por unidade (stationId) preservando a ordem que já vem do servidor.
  const unidades: { stationId: string; unidade: string; maquinas: Maquina[] }[] = [];
  for (const m of maquinas) {
    let grupo = unidades.find((u) => u.stationId === m.stationId);
    if (!grupo) {
      grupo = { stationId: m.stationId, unidade: m.unidade, maquinas: [] };
      unidades.push(grupo);
    }
    grupo.maquinas.push(m);
  }

  const [abaUnidade, setAbaUnidade] = useState<string>(unidades[0]?.stationId ?? TAB_TOTAIS);
  const [maquinaPorUnidade, setMaquinaPorUnidade] = useState<Record<string, string>>({});

  if (maquinas.length === 0) return <p style={{ color: "var(--aco-d)" }}>Nenhuma máquina cadastrada ainda.</p>;

  const grupoAtivo = unidades.find((u) => u.stationId === abaUnidade);
  const maquinaAtivaId = grupoAtivo ? (maquinaPorUnidade[grupoAtivo.stationId] ?? grupoAtivo.maquinas[0].id) : "";
  const maquinaAtiva = grupoAtivo?.maquinas.find((m) => m.id === maquinaAtivaId) ?? grupoAtivo?.maquinas[0];

  return (
    <div>
      <div className="maq-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={abaUnidade === TAB_TOTAIS}
          className={"maq-tab" + (abaUnidade === TAB_TOTAIS ? " active" : "")}
          onClick={() => setAbaUnidade(TAB_TOTAIS)}
        >
          <span className="maq-tab-titulo">Resumo geral</span>
          <span className="maq-tab-sub">TOTAIS</span>
        </button>
        {unidades.map((u) => (
          <button
            key={u.stationId}
            role="tab"
            aria-selected={u.stationId === abaUnidade}
            className={"maq-tab" + (u.stationId === abaUnidade ? " active" : "")}
            onClick={() => setAbaUnidade(u.stationId)}
          >
            <span className="maq-tab-titulo">{u.unidade}</span>
            <span className="maq-tab-sub">
              {u.maquinas.length > 1 ? `${u.maquinas.length} máquinas` : "1 máquina"}
              {u.maquinas.map((m) => (
                <span key={m.id} className={"maq-dot " + (m.offline ? "err" : m.emManutencao ? "at" : "ok")} />
              ))}
            </span>
          </button>
        ))}
      </div>

      {grupoAtivo && grupoAtivo.maquinas.length > 1 && (
        <div className="maq-subtabs" role="tablist">
          {grupoAtivo.maquinas.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={m.id === maquinaAtivaId}
              className={"maq-subtab" + (m.id === maquinaAtivaId ? " active" : "")}
              onClick={() => setMaquinaPorUnidade((prev) => ({ ...prev, [grupoAtivo.stationId]: m.id }))}
            >
              Máquina {m.numero}
              <span className={"maq-dot " + (m.offline ? "err" : m.emManutencao ? "at" : "ok")} />
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {abaUnidade === TAB_TOTAIS ? (
          <div className="maq-painel">
            <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Totais de todas as máquinas</h3>
            <p style={{ color: "var(--aco-d)", fontSize: 13, marginBottom: 18 }}>
              Soma de tudo desde o último "Marcar pago hoje" de cada máquina.
            </p>
            <div className="stats" style={{ marginBottom: 22 }}>
              <div className="stat">
                <div className="lab">Valor total (todas as máquinas)</div>
                <div className="val">{totais.valorTotalGeral}</div>
              </div>
            </div>
            <h4 className="section-title" style={{ margin: "0 0 10px" }}>Por tipo de lavagem</h4>
            {totais.porPrograma.length === 0 ? (
              <p style={{ color: "var(--aco-d)", fontSize: 14 }}>Nenhuma lavagem concluída desde o último fechamento.</p>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr><th>Programa</th><th>Quantidade</th><th>Valor</th></tr>
                  </thead>
                  <tbody>
                    {totais.porPrograma.map((p) => (
                      <tr key={p.programa}>
                        <td>{p.programa}</td>
                        <td>{p.qtd}</td>
                        <td>{p.valor}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          maquinaAtiva && <PainelMaquina m={maquinaAtiva} lavadores={lavadores} />
        )}
      </div>
    </div>
  );
}
