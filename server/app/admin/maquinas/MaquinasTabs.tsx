"use client";

import { useState } from "react";
import { marcarPagamento, alternarManutencao, definirOperador, salvarParticipante, removerParticipante } from "./actions";
import { salvarPrecoUnidade } from "../precos/actions";

type Lavagem = {
  id: string;
  quando: string;
  programa: string;
  valor: string;
  cliente: string;
};

type TipoParticipacao = "LAVADOR" | "COMISSAO1" | "COMISSAO2" | "ALUGUEL";

const TIPOS_PARTICIPACAO: TipoParticipacao[] = ["LAVADOR", "COMISSAO1", "COMISSAO2", "ALUGUEL"];
const LABEL_TIPO: Record<TipoParticipacao, string> = {
  LAVADOR: "Lavador",
  COMISSAO1: "Comissão 1",
  COMISSAO2: "Comissão 2",
  ALUGUEL: "Aluguel",
};

type ParticipanteAtual = { tipo: TipoParticipacao; userId: string; percentual: number };

type DivisaoParticipante = {
  tipo: TipoParticipacao | "ADMIN";
  label: string;
  percentual: number;
  presencial: string;
  app: string;
  saldoCents: number;
  saldo: string;
};
type Divisao = {
  totalPresencial: string;
  totalApp: string;
  participantes: DivisaoParticipante[];
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
  participantes: ParticipanteAtual[];
  divisao: Divisao | null;
  historico: Lavagem[];
};

const NOME_TIPO: Record<number, string> = { 1: "Tipo 1", 2: "Tipo 2", 3: "Tipo 3", 4: "Tipo 4" };

type Lavador = { id: string; label: string };
type Participante = { id: string; label: string };
type Totais = {
  valorTotalGeral: string;
  porPrograma: { programa: string; qtd: number; valor: string }[];
};
type PrecoPrograma = { programId: number; nome: string; precoCents: number; proprio: boolean };

const TAB_TOTAIS = "__totais__";

function PrecosUnidade({ stationId, precos }: { stationId: string; precos: PrecoPrograma[] }) {
  return (
    <div className="maq-painel" style={{ marginBottom: 14 }}>
      <h4 className="section-title" style={{ margin: "0 0 10px" }}>
        Preços desta unidade
      </h4>
      <p style={{ color: "var(--aco-d)", fontSize: 13, marginBottom: 14 }}>
        Cada unidade cobra o valor que quiser — preencha os 4 tipos aqui (os nomes vêm da aba Preços).
      </p>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {precos.map((p) => (
          <div key={p.programId} style={{ background: "var(--verniz2)", border: "1px solid var(--linha)", borderRadius: 12, padding: "10px 14px", minWidth: 170 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--aco-d)" }}>{p.nome}</div>
            <form action={salvarPrecoUnidade} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
              <input type="hidden" name="stationId" value={stationId} />
              <input type="hidden" name="programId" value={p.programId} />
              <span style={{ fontSize: 13 }}>R$</span>
              <input
                className="field"
                style={{ width: 80, height: 30, fontSize: 13, padding: "0 8px" }}
                name="preco"
                type="number"
                step="0.01"
                min="0"
                placeholder="0,00"
                defaultValue={p.proprio ? (p.precoCents / 100).toFixed(2) : ""}
              />
              <button className="btn ghost" type="submit" style={{ height: 30, padding: "0 10px", fontSize: 12 }}>Salvar</button>
            </form>
            {!p.proprio && (
              <div style={{ fontSize: 11, color: "var(--atencao)", marginTop: 6 }}>preço ainda não definido</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ParticipantesMaquina({ m, participantesPossiveis }: { m: Maquina; participantesPossiveis: Participante[] }) {
  const somaCadastrada = m.participantes.reduce((s, p) => s + p.percentual, 0);
  const sobraAdmin = Math.max(0, 100 - somaCadastrada);

  return (
    <>
      <h4 className="section-title" style={{ margin: "26px 0 10px" }}>
        Participação na máquina
      </h4>
      <p style={{ color: "var(--aco-d)", fontSize: 13, marginBottom: 12 }}>
        A soma de todos os participantes cadastrados nunca passa de 100% — o que sobra fica automaticamente com o admin
        (hoje: <b>{sobraAdmin.toFixed(1)}%</b> pro admin).
      </p>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Tipo</th><th>Pessoa</th><th>%</th><th></th></tr>
          </thead>
          <tbody>
            {TIPOS_PARTICIPACAO.map((tipo) => {
              const atual = m.participantes.find((p) => p.tipo === tipo);
              return (
                <tr key={tipo}>
                  <td>{LABEL_TIPO[tipo]}</td>
                  <td>
                    <form action={salvarParticipante} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="hidden" name="machineId" value={m.id} />
                      <input type="hidden" name="tipo" value={tipo} />
                      <select name="userId" defaultValue={atual?.userId ?? ""} className="field" style={{ height: 32, fontSize: 13, padding: "0 8px" }}>
                        <option value="">— ninguém —</option>
                        {participantesPossiveis.map((p) => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </select>
                      <input
                        className="field"
                        name="percentual"
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        placeholder="%"
                        defaultValue={atual?.percentual || ""}
                        style={{ width: 70, height: 32, fontSize: 13, padding: "0 8px" }}
                      />
                      <button className="btn ghost" type="submit" style={{ height: 32, padding: "0 10px", fontSize: 12 }}>Salvar</button>
                    </form>
                  </td>
                  <td>{atual ? `${atual.percentual}%` : "—"}</td>
                  <td>
                    {atual && (
                      <form action={removerParticipante}>
                        <input type="hidden" name="machineId" value={m.id} />
                        <input type="hidden" name="tipo" value={tipo} />
                        <button className="btn ghost" type="submit" style={{ height: 28, padding: "0 8px", fontSize: 11 }}>Remover</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PainelMaquina({ m, lavadores, participantesPossiveis }: { m: Maquina; lavadores: Lavador[]; participantesPossiveis: Participante[] }) {
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

      <ParticipantesMaquina m={m} participantesPossiveis={participantesPossiveis} />

      {m.divisao && (
        <>
          <h4 className="section-title" style={{ margin: "26px 0 10px" }}>
            Divisão entre participantes (desde o último fechamento)
          </h4>
          <p style={{ color: "var(--aco-d)", fontSize: 13, marginBottom: 12 }}>
            O lavador já fica com 100% do presencial na hora (deve a parte de todo mundo); o admin já fica com 100% do
            app (deve a parte de todo mundo). Quem não é lavador nem admin nunca fica com dinheiro em mãos — é sempre credor.
          </p>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Participante</th><th>%</th><th>Presencial</th><th>App</th><th>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {m.divisao.participantes.map((p) => (
                  <tr key={p.tipo}>
                    <td>{p.tipo === "ADMIN" ? "Admin" : `${LABEL_TIPO[p.tipo as TipoParticipacao]} (${p.label})`}</td>
                    <td>{p.percentual.toFixed(1)}%</td>
                    <td>{p.presencial}</td>
                    <td>{p.app}</td>
                    <td style={{ fontWeight: 700 }}>
                      {p.saldoCents === 0 ? "—" : p.saldoCents > 0 ? `a receber ${p.saldo}` : `deve repassar ${p.saldo}`}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={{ fontWeight: 700 }}>Total</td>
                  <td></td>
                  <td style={{ fontWeight: 700 }}>{m.divisao.totalPresencial}</td>
                  <td style={{ fontWeight: 700 }}>{m.divisao.totalApp}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

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
  participantesPossiveis,
  totais,
  precosPorUnidade,
}: {
  maquinas: Maquina[];
  lavadores: Lavador[];
  participantesPossiveis: Participante[];
  totais: Totais;
  precosPorUnidade: Record<string, PrecoPrograma[]>;
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
          grupoAtivo && (
            <>
              <PrecosUnidade stationId={grupoAtivo.stationId} precos={precosPorUnidade[grupoAtivo.stationId] ?? []} />
              {maquinaAtiva && <PainelMaquina m={maquinaAtiva} lavadores={lavadores} participantesPossiveis={participantesPossiveis} />}
            </>
          )
        )}
      </div>
    </div>
  );
}
