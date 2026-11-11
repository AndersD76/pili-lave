"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BuscaCaixa, ResultadoVenda, ProdutoCaixa } from "@/lib/caixa";
import type { ResultadoCobranca } from "@/lib/maquininha";
import type { IdentificarCarteira } from "@/lib/nuvem";
import type { IdentificacaoCaixa } from "@/lib/rosto";

/** A cada quanto tempo o caixa pergunta pra maquininha como está indo a
 *  cobrança (driver manual: só muda quando o operador clica). */
const POLL_CARTAO_MS = 1500;

const MAX_POR_ITEM = 99;
/** Sem ninguém mexer por este tempo, a compra é cancelada (cliente foi embora). */
const OCIOSO_MS = 3 * 60 * 1000;
/** Quanto tempo a tela de "compra concluída" fica antes de voltar ao início. */
const OBRIGADO_MS = 8000;
/** Prefixo do QR que o app mostra em "Pagar na loja" (ver server/app/(pwa)/app/loja/pagar). */
const PREFIXO_QR_CARTEIRA = "PILILOJA:";
/** Reconhecimento facial: de quanto em quanto tempo manda um quadro, e por
 *  quanto tempo insiste antes de perguntar o nome. */
const ROSTO_INTERVALO_MS = 1200;
const ROSTO_LIMITE_MS = 12000;

type Item = ProdutoCaixa & { quantidade: number };
type Etapa = "COMPRANDO" | "PAGAMENTO" | "CONCLUIDA";
/** Sub-passos da etapa PAGAMENTO: escolher a forma, escanear o QR da
 *  carteira, confirmar com o cliente identificado, ou aprovar no cartão. */
type PassoPagamento = "QUEM" | "ESCOLHER" | "ESCANEANDO" | "IDENTIFICADO" | "CARTAO";
type Pessoa = { visitaId: string; nome: string };

function reais(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

/**
 * Caixa de autoatendimento — a tela do cliente. O leitor de código de barras
 * funciona como um teclado: "digita" os números e manda Enter. Por isso o
 * campo do código fica SEMPRE com o foco: o cliente só passa o produto. O
 * mesmo leitor serve pra escanear o QR de pagamento do app (ele também lê
 * 2D) — é só um texto mais longo chegando pelo mesmo jeito.
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

  const [passo, setPasso] = useState<PassoPagamento>("ESCOLHER");
  const [conectado, setConectado] = useState<boolean | null>(null);
  const [codigoCarteira, setCodigoCarteira] = useState("");
  const [cliente, setCliente] = useState<{ token: string; nome: string; walletCents: number } | null>(null);
  const campoCarteira = useRef<HTMLInputElement>(null);

  const [cobranca, setCobranca] = useState<{
    operacaoId: string; nome: string; confirmacaoManual: boolean; situacao: ResultadoCobranca["situacao"];
  } | null>(null);

  /** De quem é a compra (rosto reconhecido ou nome escolhido) — null = não
   *  identificada. Não cobra nada: só liga a venda à visita. */
  const [quem, setQuem] = useState<Pessoa | null>(null);
  /** Lista pra "Você é: …?" — null enquanto ainda tenta o rosto. */
  const [opcoes, setOpcoes] = useState<Pessoa[] | null>(null);
  const [semRosto, setSemRosto] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  const total = itens.reduce((s, i) => s + i.quantidade * i.precoCents, 0);
  const unidades = itens.reduce((s, i) => s + i.quantidade, 0);

  const focar = useCallback(() => campo.current?.focus(), []);
  const mexeu = useCallback(() => setUltimaAcao(Date.now()), []);

  const recomecar = useCallback(() => {
    setItens([]); setCodigo(""); setAviso(""); setVenda(null); setEtapa("COMPRANDO");
    setPasso("ESCOLHER"); setCodigoCarteira(""); setCliente(null); setCobranca(null);
    setQuem(null); setOpcoes(null); setSemRosto(false);
  }, []);

  // passo QUEM: descobre de quem é a compra, só entre quem está dentro da
  // loja. Ninguém com entrada registrada → segue direto, sem identificar.
  useEffect(() => {
    if (!(etapa === "PAGAMENTO" && passo === "QUEM")) return;
    let ativo = true;
    let midia: MediaStream | null = null;
    let relogio: ReturnType<typeof setTimeout> | undefined;

    const perguntar = async (imagemBase64: string | null): Promise<IdentificacaoCaixa> => {
      const res = await fetch("/api/caixa/rosto", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imagemBase64 }),
      });
      return (await res.json()) as IdentificacaoCaixa;
    };
    const quadro = (): string | null => {
      const v = video.current;
      if (!v || !v.videoWidth) return null;
      const tela = document.createElement("canvas");
      tela.width = 480;
      tela.height = Math.round((480 * v.videoHeight) / v.videoWidth);
      tela.getContext("2d")?.drawImage(v, 0, 0, tela.width, tela.height);
      return tela.toDataURL("image/jpeg", 0.85).split(",")[1] ?? null;
    };

    (async () => {
      try {
        const primeira = await perguntar(null);
        if (!ativo) return;
        if (primeira.situacao === "NINGUEM") { setPasso("ESCOLHER"); return; }
        const lista = "visitas" in primeira ? primeira.visitas : [];
        try {
          midia = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        } catch {
          midia = null; // sem câmera no totem: pergunta o nome
        }
        if (!ativo) { midia?.getTracks().forEach((t) => t.stop()); return; }
        if (!midia || !video.current) { setOpcoes(lista); return; }
        video.current.srcObject = midia;
        await video.current.play().catch(() => undefined);

        const limite = Date.now() + ROSTO_LIMITE_MS;
        const tentar = async () => {
          if (!ativo) return;
          let r: IdentificacaoCaixa | null = null;
          try {
            const img = quadro();
            if (img) r = await perguntar(img);
          } catch {
            r = null;
          }
          if (!ativo) return;
          if (r?.situacao === "OK") { setQuem({ visitaId: r.visitaId, nome: r.nome }); setPasso("ESCOLHER"); return; }
          if (r?.situacao === "NINGUEM") { setPasso("ESCOLHER"); return; }
          if (r?.situacao === "ESCOLHER") { setOpcoes(r.visitas); return; }
          if (r?.situacao === "SEM_ROSTO") setSemRosto(true);
          if (Date.now() > limite) { setOpcoes(r && "visitas" in r ? r.visitas : lista); return; }
          relogio = setTimeout(tentar, ROSTO_INTERVALO_MS);
        };
        relogio = setTimeout(tentar, 600);
      } catch {
        if (ativo) setPasso("ESCOLHER"); // não deu pra consultar: segue sem identificar
      }
    })();

    return () => {
      ativo = false;
      clearTimeout(relogio);
      midia?.getTracks().forEach((t) => t.stop());
    };
  }, [etapa, passo]);

  // foco de volta no campo sempre que a tela de compra aparece
  useEffect(() => {
    if (etapa === "COMPRANDO") focar();
  }, [etapa, itens.length, focar]);

  // foco no campo de escaneio do QR enquanto esperando o cliente mostrar o código
  useEffect(() => {
    if (etapa === "PAGAMENTO" && passo === "ESCANEANDO") campoCarteira.current?.focus();
  }, [etapa, passo]);

  // entrando na tela de pagamento: confere se tem internet, pra saber se
  // oferece "Carteira do app" (precisa da nuvem) ou só cartão
  useEffect(() => {
    if (etapa !== "PAGAMENTO") return;
    let ativo = true;
    fetch("/api/caixa/conectado", { cache: "no-store" })
      .then((r) => r.json())
      .then((r) => { if (ativo) setConectado(!!r.conectado); })
      .catch(() => { if (ativo) setConectado(false); });
    return () => { ativo = false; };
  }, [etapa]);

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

  const corpoItens = () => ({
    itens: itens.map((i) => ({ produtoId: i.id, quantidade: i.quantidade })), visitaId: quem?.visitaId ?? null,
  });

  // entrando no passo CARTAO: pede a cobrança pra maquininha (driver atual
  // ou futuro — a tela não sabe qual é, só segue o contrato)
  useEffect(() => {
    if (!(etapa === "PAGAMENTO" && passo === "CARTAO")) return;
    let ativo = true;
    fetch("/api/caixa/cartao/iniciar", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpoItens()),
    })
      .then((r) => r.json())
      .then((r) => {
        if (!ativo) return;
        if (r.operacaoId) setCobranca({ operacaoId: r.operacaoId, nome: r.nome, confirmacaoManual: r.confirmacaoManual, situacao: "AGUARDANDO" });
        else { setAviso(r.erro ?? "Não foi possível iniciar a cobrança."); setPasso("ESCOLHER"); }
      })
      .catch(() => { if (ativo) { setAviso("Não foi possível falar com a maquininha. Tente de novo."); setPasso("ESCOLHER"); } });
    return () => { ativo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapa, passo]);

  // enquanto aguarda, pergunta pra maquininha de tempos em tempos — no
  // driver manual só muda quando o operador clica; num driver de verdade
  // é assim que o caixa percebe que o cartão foi aprovado sozinho
  useEffect(() => {
    if (!cobranca || cobranca.situacao !== "AGUARDANDO") return;
    let ativo = true;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/caixa/cartao/status?operacaoId=${cobranca.operacaoId}`, { cache: "no-store" });
        const r = (await res.json()) as ResultadoCobranca;
        if (ativo && r.situacao !== "AGUARDANDO") setCobranca((c) => (c ? { ...c, situacao: r.situacao } : c));
      } catch {
        // tenta de novo no próximo tick — rede pode ter oscilado
      }
    }, POLL_CARTAO_MS);
    return () => { ativo = false; clearInterval(t); };
  }, [cobranca]);

  // cobrança aprovada (pelo operador ou, no futuro, pela própria
  // maquininha): fecha a venda local. O ref evita mandar duas vezes.
  const concluindoCartao = useRef(false);
  useEffect(() => {
    if (!cobranca || cobranca.situacao !== "APROVADO" || concluindoCartao.current) return;
    concluindoCartao.current = true;
    fetch("/api/caixa/cartao/concluir", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operacaoId: cobranca.operacaoId, ...corpoItens() }),
    })
      .then((r) => r.json())
      .then((r: ResultadoVenda) => {
        if (r.ok) { setVenda({ numero: r.numero, totalCents: r.totalCents }); setEtapa("CONCLUIDA"); }
        else { setAviso(r.erro); setPasso("ESCOLHER"); setCobranca(null); }
      })
      .catch(() => { setAviso("A maquininha aprovou, mas não foi possível fechar a venda. Chame o dono."); setPasso("ESCOLHER"); setCobranca(null); })
      .finally(() => { concluindoCartao.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobranca]);

  async function confirmarCartaoManual(aprovado: boolean) {
    if (!cobranca) return;
    mexeu();
    try {
      await fetch("/api/caixa/cartao/confirmar-manual", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operacaoId: cobranca.operacaoId, aprovado }),
      });
    } catch {
      setAviso("Não foi possível registrar a confirmação. Tente de novo.");
    }
    if (!aprovado) { setPasso("ESCOLHER"); setCobranca(null); setAviso("Pagamento recusado no cartão."); }
    // aprovado: a consulta periódica (useEffect acima) pega a mudança sozinha
  }

  async function lerCodigoCarteira(e: React.FormEvent) {
    e.preventDefault();
    const lido = codigoCarteira.trim();
    setCodigoCarteira("");
    mexeu();
    if (!lido || ocupado) return;
    if (!lido.startsWith(PREFIXO_QR_CARTEIRA)) {
      setAviso("Esse código não é de pagamento. Peça pro cliente abrir \"Pagar na loja\" no app.");
      campoCarteira.current?.focus();
      return;
    }
    const token = lido.slice(PREFIXO_QR_CARTEIRA.length);
    setOcupado(true);
    setAviso("");
    try {
      const res = await fetch("/api/caixa/carteira/identificar", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      const r = (await res.json()) as IdentificarCarteira;
      if (r.situacao === "OK") {
        setCliente({ token, nome: r.nome, walletCents: r.walletCents });
        setPasso("IDENTIFICADO");
      } else {
        setAviso(
          r.situacao === "EXPIRADO" ? "O código venceu. Peça pro cliente abrir a tela de pagamento de novo."
          : r.situacao === "SEM_CONEXAO" ? "Sem internet — não dá pra pagar pela carteira agora."
          : "mensagem" in r ? r.mensagem : "Não foi possível identificar o cliente."
        );
        campoCarteira.current?.focus();
      }
    } catch {
      setAviso("Não foi possível consultar a carteira. Tente de novo.");
      campoCarteira.current?.focus();
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarCarteira() {
    if (!cliente) return;
    mexeu();
    setOcupado(true);
    setAviso("");
    try {
      const res = await fetch("/api/caixa/carteira/confirmar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: cliente.token, ...corpoItens() }),
      });
      const r = (await res.json()) as ResultadoVenda;
      if (r.ok) {
        setVenda({ numero: r.numero, totalCents: r.totalCents });
        setEtapa("CONCLUIDA");
      } else {
        setAviso(r.erro);
        setPasso("ESCOLHER");
        setCliente(null);
      }
    } catch {
      setAviso("Não foi possível concluir a compra. Confira se a venda não foi cobrada antes de tentar de novo.");
      setPasso("ESCOLHER");
      setCliente(null);
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
        {aviso && <p className="caixa-aviso" style={{ marginTop: 12 }}>{aviso}</p>}

        {passo === "QUEM" && (
          <>
            {opcoes === null ? (
              <>
                <p className="sub" style={{ margin: "16px 0 8px", fontSize: 18 }}>
                  {semRosto ? "Fique em frente à tela para reconhecimento facial" : "Olhe para a câmera — identificando…"}
                </p>
                <video ref={video} muted playsInline className="caixa-camera" />
              </>
            ) : (
              <>
                <p className="sub" style={{ margin: "16px 0 8px", fontSize: 18 }}>Você é:</p>
                {opcoes.map((o) => (
                  <button
                    key={o.visitaId} className="btn caixa-btn" style={{ marginTop: 10, minWidth: 320 }}
                    onClick={() => { mexeu(); setQuem(o); setPasso("ESCOLHER"); }}
                  >
                    {o.nome}
                  </button>
                ))}
                <button className="btn ghost caixa-btn" style={{ marginTop: 12 }} onClick={() => { mexeu(); setPasso("ESCOLHER"); }}>
                  Nenhum destes
                </button>
              </>
            )}
            <button className="btn ghost caixa-btn" onClick={() => { mexeu(); setEtapa("COMPRANDO"); }} style={{ marginTop: 12 }}>
              Voltar para a compra
            </button>
          </>
        )}

        {passo === "ESCOLHER" && (
          <>
            {quem && <p style={{ marginTop: 12, fontSize: 20, fontWeight: 600 }}>Compra de {quem.nome}</p>}
            <p className="sub" style={{ margin: "16px 0 8px" }}>Como o cliente vai pagar?</p>
            <button
              className="btn caixa-btn" disabled={ocupado || conectado === null || !conectado}
              onClick={() => { mexeu(); setAviso(""); setPasso("ESCANEANDO"); }}
            >
              Carteira do app
            </button>
            {conectado === false && (
              <p className="sub" style={{ marginTop: 6 }}>Sem internet no momento — só dá pra pagar no cartão.</p>
            )}
            <button
              className="btn caixa-btn" style={{ marginTop: 12 }} disabled={ocupado}
              onClick={() => { mexeu(); setAviso(""); setPasso("CARTAO"); }}
            >
              Cartão (maquininha)
            </button>
            <button className="btn ghost caixa-btn" onClick={() => { mexeu(); setEtapa("COMPRANDO"); }} disabled={ocupado} style={{ marginTop: 12 }}>
              Voltar para a compra
            </button>
          </>
        )}

        {passo === "ESCANEANDO" && (
          <>
            <p className="sub" style={{ margin: "16px 0 8px" }}>
              Peça pro cliente abrir &quot;Pagar na loja&quot; no app e aproxime o QR do leitor.
            </p>
            <form onSubmit={lerCodigoCarteira}>
              <input
                ref={campoCarteira} className="field" value={codigoCarteira} autoFocus autoComplete="off"
                placeholder="Aguardando leitura do código…" disabled={ocupado}
                onChange={(e) => setCodigoCarteira(e.target.value)}
                style={{ width: 420, textAlign: "center" }}
              />
            </form>
            <button className="btn ghost caixa-btn" onClick={() => { mexeu(); setAviso(""); setPasso("ESCOLHER"); }} disabled={ocupado} style={{ marginTop: 16 }}>
              Voltar
            </button>
          </>
        )}

        {passo === "IDENTIFICADO" && cliente && (
          <>
            <p className="sub" style={{ margin: "16px 0 4px" }}>Pagando:</p>
            <p style={{ fontSize: 22, fontWeight: 700 }}>{cliente.nome}</p>
            <p className="sub">Saldo na carteira: {reais(cliente.walletCents)}</p>
            <button className="btn caixa-btn" style={{ marginTop: 16 }} onClick={confirmarCarteira} disabled={ocupado}>
              {ocupado ? "Concluindo…" : "Confirmar pagamento"}
            </button>
            <button
              className="btn ghost caixa-btn" style={{ marginTop: 12 }} disabled={ocupado}
              onClick={() => { mexeu(); setAviso(""); setCliente(null); setPasso("ESCOLHER"); }}
            >
              Não é esse cliente
            </button>
          </>
        )}

        {passo === "CARTAO" && (
          <>
            {!cobranca ? (
              <p className="sub" style={{ margin: "16px 0 8px" }}>Chamando a maquininha…</p>
            ) : cobranca.situacao === "AGUARDANDO" ? (
              <>
                <p className="sub" style={{ margin: "16px 0 8px" }}>
                  {cobranca.confirmacaoManual
                    ? "Aprove o pagamento na maquininha ao lado."
                    : `Aguardando o cliente no ${cobranca.nome}…`}
                </p>
                {cobranca.confirmacaoManual && (
                  <>
                    <button className="btn caixa-btn" onClick={() => confirmarCartaoManual(true)} disabled={ocupado}>
                      Pagamento aprovado
                    </button>
                    <button
                      className="btn ghost caixa-btn" style={{ marginTop: 12 }} disabled={ocupado}
                      onClick={() => confirmarCartaoManual(false)}
                    >
                      Pagamento recusado
                    </button>
                  </>
                )}
              </>
            ) : (
              <p className="sub" style={{ margin: "16px 0 8px" }}>Concluindo…</p>
            )}
            <button
              className="btn ghost caixa-btn" style={{ marginTop: 12 }} disabled={ocupado}
              onClick={() => { mexeu(); setAviso(""); setPasso("ESCOLHER"); setCobranca(null); }}
            >
              Voltar
            </button>
          </>
        )}
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
            <button className="btn caixa-btn" onClick={() => { mexeu(); setAviso(""); setOpcoes(null); setSemRosto(false); setPasso(quem ? "ESCOLHER" : "QUEM"); setEtapa("PAGAMENTO"); }}>Pagar</button>
          </footer>
        </>
      )}
    </div>
  );
}
