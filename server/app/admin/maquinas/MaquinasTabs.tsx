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
  unidade: string;
  status: string;
  offline: boolean;
  emManutencao: boolean;
  ultimaBatida: string;
  sensores: string;
  licenca: { label: string; classe: "ok" | "at" | "off" | "err" };
  operadorId: string | null;
  historico: Lavagem[];
};

type Lavador = { id: string; label: string };

export default function MaquinasTabs({
  maquinas,
  lavadores,
}: {
  maquinas: Maquina[];
  lavadores: Lavador[];
}) {
  const [ativaId, setAtivaId] = useState(maquinas[0]?.id ?? "");
  const ativa = maquinas.find((m) => m.id === ativaId) ?? maquinas[0];

  if (!ativa) return <p style={{ color: "var(--aco-d)" }}>Nenhuma máquina cadastrada ainda.</p>;

  return (
    <div>
      <div className="maq-tabs" role="tablist">
        {maquinas.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={m.id === ativa.id}
            className={"maq-tab" + (m.id === ativa.id ? " active" : "")}
            onClick={() => setAtivaId(m.id)}
          >
            <span className="maq-tab-titulo">{m.unidade}</span>
            <span className="maq-tab-sub">
              Máquina {m.numero}
              <span
                className={
                  "maq-dot " +
                  (m.offline ? "err" : m.emManutencao ? "at" : "ok")
                }
              />
            </span>
          </button>
        ))}
      </div>

      <div className="maq-painel">
        <div className="maq-painel-topo">
          <div>
            <h3 style={{ fontSize: 20, fontWeight: 800 }}>
              {ativa.unidade} — Máquina {ativa.numero}
            </h3>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <span className={"chip " + (ativa.offline ? "err" : ativa.emManutencao ? "at" : "ok")}>
                {ativa.offline ? "OFFLINE" : ativa.status}
              </span>
              <span className={"chip " + ativa.licenca.classe}>{ativa.licenca.label}</span>
            </div>
            <p style={{ color: "var(--aco-d)", fontSize: 13, marginTop: 8 }}>
              Última batida: {ativa.ultimaBatida} · {ativa.sensores}
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <form action={marcarPagamento}>
              <input type="hidden" name="id" value={ativa.id} />
              <button className="btn ghost" type="submit">Marcar pago hoje</button>
            </form>
            <form action={alternarManutencao}>
              <input type="hidden" name="id" value={ativa.id} />
              <button className="btn ghost" type="submit">
                {ativa.emManutencao ? "Tirar de manutenção" : "Pôr em manutenção"}
              </button>
            </form>
          </div>
        </div>

        <form action={definirOperador} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 18 }}>
          <input type="hidden" name="id" value={ativa.id} />
          <label style={{ fontSize: 13, color: "var(--aco-d)" }}>Lavador responsável:</label>
          <select name="operadorId" defaultValue={ativa.operadorId ?? ""} className="field" style={{ width: 240, height: 36, fontSize: 13, padding: "0 10px" }}>
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
        {ativa.historico.length === 0 ? (
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
                {ativa.historico.map((h) => (
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
    </div>
  );
}
