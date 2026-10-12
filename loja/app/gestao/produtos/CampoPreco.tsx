"use client";

import { useState } from "react";

function reaisCampo(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * Preço de venda no cadastro do produto. O normal é informar o PERCENTUAL
 * sobre o custo: o preço é calculado e acompanha o custo sozinho. Marcar
 * "preço manual" troca pra digitação livre — com o aviso de que o produto
 * deixa de ser reajustado quando chegar nota com custo novo.
 */
export function CampoPreco({
  custoCents, margemPct, precoCents, precoManual, travado,
}: {
  custoCents: number; margemPct: number | null; precoCents: number | null; precoManual: boolean; travado: boolean;
}) {
  const [manual, setManual] = useState(precoManual);
  const [pct, setPct] = useState(margemPct === null ? "" : String(margemPct).replace(".", ","));
  const bloqueio = travado ? ({ readOnly: true, style: { opacity: 0.6 } } as const) : {};

  function alternar(marcado: boolean) {
    if (travado) return;
    if (marcado && !window.confirm("Este item não sofrerá mais reajustes automáticos. Deseja prosseguir?")) return;
    setManual(marcado);
  }

  // prévia do preço com o custo que está salvo (o servidor recalcula ao salvar)
  const n = Number(pct.replace("%", "").replace(",", "."));
  const previa = pct.trim() && Number.isFinite(n) && n >= 0 ? Math.round(custoCents * (1 + n / 100)) : null;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="linha-form">
        {manual ? (
          <label className="rotulo" style={{ width: 170 }}>
            Preço de venda (R$)
            <input className="field" name="preco" defaultValue={reaisCampo(precoCents)} inputMode="decimal" placeholder="0,00" required {...bloqueio} />
          </label>
        ) : (
          <>
            <label className="rotulo" style={{ width: 170 }}>
              Percentual de venda (%)
              <input
                className="field" name="margem" value={pct} inputMode="decimal" placeholder="ex.: 40"
                onChange={(e) => !travado && setPct(e.target.value)} {...bloqueio}
              />
            </label>
            <div className="rotulo" style={{ paddingBottom: 10 }}>
              Preço de venda
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--cromo)", marginTop: 6 }}>
                {previa !== null ? `R$ ${reaisCampo(previa)}` : precoCents !== null ? `R$ ${reaisCampo(precoCents)}` : "sem preço"}
              </div>
            </div>
          </>
        )}
      </div>
      <label className="sub" style={{ display: "flex", gap: 8, alignItems: "center", cursor: travado ? "default" : "pointer" }}>
        <input type="checkbox" name="precoManual" checked={manual} onChange={(e) => alternar(e.target.checked)} />
        Preço manual (sem reajuste automático)
      </label>
      <span className="sub" style={{ fontSize: 12 }}>
        {manual
          ? "Este produto não é reajustado quando o custo muda. Ele aparece na lista \"Sem reajuste automático\"."
          : previa === null && precoCents !== null
          ? "Este produto ainda não tem percentual: o preço atual fica como está até você informar um."
          : "O preço é o custo mais o percentual, e é recalculado sozinho quando chega nota com custo novo."}
      </span>
    </div>
  );
}
