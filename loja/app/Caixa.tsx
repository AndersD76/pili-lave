"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BuscaCaixa, ProdutoCaixa, ResultadoVenda } from "@/lib/caixa";

const MAX_POR_ITEM = 99;
/** Sem ninguém mexer por este tempo, a compra é cancelada (cliente foi embora). */
const OCIOSO_MS = 3 * 60 * 1000;
/** Quanto tempo a tela de "compra concluída" fica antes de voltar ao início. */
const OBRIGADO_MS = 8000;

type Item = ProdutoCaixa & { quantidade: number };
type Etapa = "COMPRANDO" | "PAGAMENTO" | "CONCLUIDA";

function reais(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

/**
 * Caixa de autoatendimento — a tela do cliente. O leitor de código de barras
 * funciona como um teclado: "digita" os números e manda Enter. Por isso o
 * campo do código fica SEMPRE com o foco: o cliente só passa o produto.
 */
export function Caixa({ lojaNome }: { lojaNome: string }) {
  const [etapa, setEtapa] = useState<Etapa>("COMPRANDO");
  const [itens, setItens] = useState<Item[]>([]);
  const [codigo, setCodigo] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [venda, setVenda] = useState<{ numero: number; totalCents: number } | null>(null);
  /** Muda a cada ação do cliente — reinicia o relógio de ociosidade. */
  const [ultimaAcao, setUltimaAcao] = useState(0);
  const campo = useRef<HTMLInputElement>(null);

  const total = itens.reduce((s, i) => s + i.quantidade * i.precoCents, 0);
  const unidades = itens.reduce((s, i) => s + i.quantidade, 0);

  const focar = useCallback(() => campo.current?.focus(), []);
  const mexeu = useCallback(() => setUltimaAcao(Date.now()), []);

  const recomecar = useCallback(() => {
    setItens([]); setCodigo(""); setAviso(""); setVenda(null); setEtapa("COMPRANDO");
  }, []);

  // foco de volta no campo sempre que a tela de compra aparece
  useEffect(() => {
    if (etapa === "COMPRANDO") focar();
  }, [etapa, itens.length, focar]);

  // compra parada: cancela sozinha
  useEffect(() => {
    if (itens.length === 0 || etapa === "CONCLUIDA") return;
    const t = setTimeout(recomecar, OCIOSO_MS);
    return () => clearTimeout(t);
  }, [ultimaAcao, itens.length, etapa, recomecar]);

  // depois de concluída, volta pro início
  useEffect(() => {
    if (etapa !== "CONCLUIDA") return;
    const t = setTimeout(recomecar, OBRIGADO_MS);
    return () => clearTimeout(t);
  }, [etapa, recomecar]);

  async function lerCodigo(e: React.FormEvent) {
    e.preventDefault();
    const lido = codigo.replace(/\D/g, "");
    setCodigo("");
    mexeu();
    if (!lido || ocupado) return;
    setOcupado(true);
    try {
      const res = await fetch(`/api/caixa/produto?codigo=${lido}`, { cache: "no-store" });
      const r = (await res.json()) as BuscaCaixa;
      if (r.situacao === "OK") {
        const p = r.produto;
        setAviso("");
        setItens((atual) => {
          const ja = atual.find((i) => i.id === p.id);
          if (!ja) return [...atual, { ...p, quantidade: 1 }];
          return atual.map((i) =>
            // preço e nome sempre os do cadastro agora
            i.id === p.id ? { ...i, ...p, quantidade: Math.min(MAX_POR_ITEM, i.quantidade + 1) } : i
          );
        });
      } else if (r.situacao === "INDISPONIVEL") {
        setAviso(`"${r.nome}" não está disponível para venda no momento.`);
      } else {
        setAviso(`Produto não encontrado (código ${lido}). Confira o código de barras e tente de novo.`);
      }
    } catch {
      setAviso("Não foi possível consultar o produto. Tente de novo.");
    } finally {
      setOcupado(false);
      focar();
    }
  }

  function mudarQuantidade(id: string, delta: number) {
    mexeu();
    setItens((atual) =>
      atual
        .map((i) => (i.id === id ? { ...i, quantidade: Math.min(MAX_POR_ITEM, i.quantidade + delta) } : i))
        .filter((i) => i.quantidade > 0)
    );
    focar();
  }

  async function pagar() {
    mexeu();
    setOcupado(true);
    setAviso("");
    try {
      const res = await fetch("/api/caixa/finalizar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itens: itens.map((i) => ({ produtoId: i.id, quantidade: i.quantidade })) }),
      });
      const r = (await res.json()) as ResultadoVenda;
      if (r.ok) {
        setVenda({ numero: r.numero, totalCents: r.totalCents });
        setEtapa("CONCLUIDA");
      } else {
        setAviso(r.erro);
        setEtapa("COMPRANDO");
      }
    } catch {
      setAviso("Não foi possível concluir a compra. Tente de novo.");
      setEtapa("COMPRANDO");
    } finally {
      setOcupado(false);
    }
  }

  if (etapa === "CONCLUIDA" && venda) {
    return (
      <div className="caixa-centro">
        <div className="caixa-ok">✓</div>
        <h1 className="caixa-titulo">Compra concluída</h1>
        <p className="caixa-total">{reais(venda.totalCents)}</p>
        <p className="sub" style={{ fontSize: 18 }}>Venda nº {venda.numero}. Obrigado e volte sempre!</p>
        <button className="btn caixa-btn" onClick={recomecar} style={{ marginTop: 24 }}>Nova compra</button>
      </div>
    );
  }

  if (etapa === "PAGAMENTO") {
    return (
      <div className="caixa-centro">
        <p className="sub" style={{ fontSize: 18 }}>{unidades} {unidades === 1 ? "item" : "itens"}</p>
        <h1 className="caixa-titulo">Total a pagar</h1>
        <p className="caixa-total">{reais(total)}</p>
        <p className="chip at" style={{ fontSize: 14, margin: "8px 0 20px" }}>
          Pagamento simulado — fase de teste, nada é cobrado
        </p>
        <button className="btn caixa-btn" onClick={pagar} disabled={ocupado}>
          {ocupado ? "Concluindo…" : "Confirmar pagamento"}
        </button>
        <button className="btn ghost caixa-btn" onClick={() => { mexeu(); setEtapa("COMPRANDO"); }} disabled={ocupado} style={{ marginTop: 12 }}>
          Voltar para a compra
        </button>
      </div>
    );
  }

  return (
    <div className="caixa" onClick={focar}>
      <header className="caixa-topo">
        <span className="sub" style={{ letterSpacing: "0.12em", textTransform: "uppercase" }}>{lojaNome}</span>
        <form onSubmit={lerCodigo} className="caixa-leitor">
          <input
            ref={campo} className="field" value={codigo} inputMode="numeric" autoFocus autoComplete="off"
            placeholder="Passe o produto no leitor ou digite o código de barras"
            onChange={(e) => { setCodigo(e.target.value); mexeu(); }}
          />
          <button className="btn ghost" type="submit" style={{ height: 48 }}>Adicionar</button>
        </form>
        {aviso && <p className="caixa-aviso">{aviso}</p>}
      </header>

      {itens.length === 0 ? (
        <div className="caixa-centro" style={{ flex: 1 }}>
          <h1 className="caixa-titulo">Bem-vindo</h1>
          <p className="sub" style={{ fontSize: 20 }}>Passe o primeiro produto no leitor para começar.</p>
        </div>
      ) : (
        <>
          <ul className="caixa-lista">
            {itens.map((i) => (
              <li key={i.id} className="caixa-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="caixa-nome">{i.nome}</div>
                  <div className="sub">{reais(i.precoCents)} cada</div>
                </div>
                <div className="caixa-qtd">
                  <button
                    type="button" aria-label={i.quantidade === 1 ? `Remover ${i.nome}` : `Tirar um ${i.nome}`}
                    onClick={() => mudarQuantidade(i.id, -1)}
                  >
                    {i.quantidade === 1 ? "×" : "−"}
                  </button>
                  <span>{i.quantidade}</span>
                  <button
                    type="button" aria-label={`Mais um ${i.nome}`} disabled={i.quantidade >= MAX_POR_ITEM}
                    onClick={() => mudarQuantidade(i.id, 1)}
                  >
                    +
                  </button>
                </div>
                <div className="caixa-sub">{reais(i.quantidade * i.precoCents)}</div>
              </li>
            ))}
          </ul>
          <footer className="caixa-rodape">
            <button className="btn ghost caixa-btn" onClick={recomecar}>Cancelar compra</button>
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div className="sub">{unidades} {unidades === 1 ? "item" : "itens"}</div>
              <div className="caixa-total" style={{ fontSize: 36 }}>{reais(total)}</div>
            </div>
            <button className="btn caixa-btn" onClick={() => { mexeu(); setAviso(""); setEtapa("PAGAMENTO"); }}>Pagar</button>
          </footer>
        </>
      )}
    </div>
  );
}
