"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api, money } from "../client";
import { Nav } from "../nav";

const VALORES = [2000, 3000, 5000, 10000];
type Topup = { id: string; pixPayload: string | null; status: string };
type Tx = { id: string; amountCents: number; kind: string; createdAt: string };
const KIND: Record<string, string> = { TOPUP: "Recarga", WASH: "Lavagem", REFUND: "Estorno", ADJUST: "Ajuste" };

export default function Recarga() {
  const router = useRouter();
  const [saldo, setSaldo] = useState(0);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [amount, setAmount] = useState(VALORES[1]);
  const [topup, setTopup] = useState<Topup | null>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [pag, setPag] = useState<{ disponivel: boolean; teste: boolean } | null>(null);
  const [forma, setForma] = useState<"PIX" | "CREDITO" | "DEBITO">("PIX");
  const [cartao, setCartao] = useState({
    numero: "", nome: "", mes: "", ano: "", cvv: "",
    cpfCnpj: "", cep: "", numeroEndereco: "",
  });
  const [msgCartao, setMsgCartao] = useState("");

  /* Cobrança no cartão SEM sair do app: os dados vão para o nosso servidor
     e dele direto ao Asaas — nada é guardado aqui nem abre página externa. */
  async function pagarCartao() {
    setError(""); setMsgCartao(""); setLoading(true);
    try {
      const r = await api<{ status: string; aviso?: string }>("/api/wallet/topup/cartao", {
        body: { amountCents: amount, tipo: forma, cartao },
      });
      if (r.status === "PAID") {
        setMsgCartao("Pagamento aprovado! Saldo creditado.");
        setCartao({ numero: "", nome: "", mes: "", ano: "", cvv: "", cpfCnpj: "", cep: "", numeroEndereco: "" });
        loadWallet();
      } else {
        setMsgCartao(r.aviso ?? "Pagamento em análise.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível pagar");
    } finally {
      setLoading(false);
    }
  }
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  function loadWallet() {
    api<{ walletCents: number; txs: Tx[] }>("/api/wallet")
      .then((r) => { setSaldo(r.walletCents); setTxs(r.txs); })
      .catch(() => router.replace("/app/login"));
  }
  useEffect(() => {
    loadWallet();
    // situação do pagamento: avisa ANTES de o cliente tentar recarregar
    api<{ disponivel: boolean; teste: boolean }>("/api/pagamento", { auth: false })
      .then(setPag).catch(() => {});
    return () => { if (poll.current) clearInterval(poll.current); };
  }, []);

  async function gerar() {
    setError(""); setLoading(true);
    try {
      const t = await api<Topup>("/api/wallet/topup", { body: { amountCents: amount, method: "PIX" } });
      setTopup(t);
      if (t.pixPayload) setQrUrl(await QRCode.toDataURL(t.pixPayload, { width: 480, margin: 1 }));
      poll.current = setInterval(async () => {
        try {
          const st = await api<{ status: string }>(`/api/wallet/topup/${t.id}`);
          if (st.status === "PAID") {
            if (poll.current) clearInterval(poll.current);
            setTopup(null); setQrUrl("");
            loadWallet();
          }
        } catch { /* tenta de novo */ }
      }, 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível gerar a cobrança");
    } finally {
      setLoading(false);
    }
  }

  async function copiar() {
    if (!topup?.pixPayload) return;
    await navigator.clipboard.writeText(topup.pixPayload);
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  }

  if (topup?.pixPayload)
    return (
      <>
        <h1>Pague o PIX</h1>
        <div className="qrcard">
          {qrUrl && <img src={qrUrl} alt="QR do PIX" />}
          <div className="tipo">{money(amount)}</div>
        </div>
        <p className="sub center">Abra o app do banco, pague, e o saldo entra sozinho.</p>
        <button className="btn ghost" onClick={copiar}>{copied ? "Copiado!" : "Copiar código PIX"}</button>
        <p className="sub center">Aguardando pagamento…</p>
        <Nav />
      </>
    );

  return (
    <>
      <div className="card">
        <div className="lab">Saldo disponível</div>
        <div className="money"><span className="cur">R$</span>{(saldo / 100).toFixed(2).replace(".", ",")}</div>
      </div>
      {/* Avisa ANTES de o cliente escolher o valor e descobrir no erro. */}
      {pag && !pag.disponivel && (
        <div className="card" style={{ borderColor: "var(--atencao)" }}>
          <div className="lab" style={{ color: "var(--atencao)" }}>Recarga indisponível</div>
          <p className="sub">
            O pagamento por PIX ainda não está ativo. Fale com o atendimento para
            adicionar saldo.
          </p>
        </div>
      )}
      {pag?.teste && (
        <p className="sub" style={{ color: "var(--atencao)" }}>
          Ambiente de teste: a cobrança é simulada e não gera pagamento real.
        </p>
      )}

      <div>
        <div className="lab">Adicionar quanto?</div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {VALORES.map((v) => (
            <button key={v} type="button" className={`opt${amount === v ? " sel" : ""}`}
              style={{ justifyContent: "center" }} onClick={() => setAmount(v)}>
              <span className="preco">{money(v)}</span>
            </button>
          ))}
        </div>
      </div>
      {/* Forma de pagamento — tudo resolvido aqui dentro, sem abrir site. */}
      <div>
        <div className="lab">Como quer pagar?</div>
        <div className="abas">
          <button className={forma === "PIX" ? "on" : ""} onClick={() => setForma("PIX")}>PIX</button>
          <button className={forma === "CREDITO" ? "on" : ""} onClick={() => setForma("CREDITO")}>Crédito</button>
          <button className={forma === "DEBITO" ? "on" : ""} onClick={() => setForma("DEBITO")}>Débito</button>
        </div>
      </div>

      {forma !== "PIX" && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="lab">Dados do cartão</div>
          <input className="field" inputMode="numeric" placeholder="Número do cartão"
            value={cartao.numero} onChange={(e) => setCartao({ ...cartao, numero: e.target.value })} />
          <input className="field" placeholder="Nome impresso no cartão"
            value={cartao.nome} onChange={(e) => setCartao({ ...cartao, nome: e.target.value })} />
          <div className="row">
            <input className="field" inputMode="numeric" placeholder="Mês (MM)" maxLength={2}
              value={cartao.mes} onChange={(e) => setCartao({ ...cartao, mes: e.target.value })} />
            <input className="field" inputMode="numeric" placeholder="Ano (AAAA)" maxLength={4}
              value={cartao.ano} onChange={(e) => setCartao({ ...cartao, ano: e.target.value })} />
            <input className="field" inputMode="numeric" placeholder="CVV" maxLength={4}
              value={cartao.cvv} onChange={(e) => setCartao({ ...cartao, cvv: e.target.value })} />
          </div>
          {/* O Asaas exige os dados do titular para a análise antifraude. */}
          <input className="field" inputMode="numeric" placeholder="CPF do titular"
            value={cartao.cpfCnpj} onChange={(e) => setCartao({ ...cartao, cpfCnpj: e.target.value })} />
          <div className="row">
            <input className="field" inputMode="numeric" placeholder="CEP"
              value={cartao.cep} onChange={(e) => setCartao({ ...cartao, cep: e.target.value })} />
            <input className="field" inputMode="numeric" placeholder="Nº"
              value={cartao.numeroEndereco} onChange={(e) => setCartao({ ...cartao, numeroEndereco: e.target.value })} />
          </div>
          <p className="sub" style={{ fontSize: 12 }}>
            {forma === "CREDITO" ? "Crédito à vista." : "Débito."} Seus dados vão direto para a
            operadora — não ficam guardados no app.
          </p>
        </div>
      )}

      {error && <p className="err">{error}</p>}
      {msgCartao && <p className="sub" style={{ color: "var(--ok)" }}>{msgCartao}</p>}

      {forma === "PIX" ? (
        <button className="btn" onClick={gerar} disabled={loading || pag?.disponivel === false}>
          {loading ? "Gerando…" : `Gerar PIX de ${money(amount)}`}
        </button>
      ) : (
        <button className="btn" onClick={pagarCartao}
          disabled={loading || pag?.disponivel === false ||
            !cartao.numero || !cartao.nome || !cartao.mes || !cartao.ano || !cartao.cvv ||
            !cartao.cpfCnpj || !cartao.cep || !cartao.numeroEndereco}>
          {loading ? "Processando…" : `Pagar ${money(amount)} no ${forma === "CREDITO" ? "crédito" : "débito"}`}
        </button>
      )}
      <div>
        <div className="lab">Movimentações</div>
        {txs.length === 0 && <p className="sub">Nada por aqui ainda.</p>}
        {txs.map((t) => (
          <div key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 2px", borderBottom: "1px solid rgba(37,207,222,0.06)" }}>
            <span>
              <b style={{ fontSize: 15 }}>{KIND[t.kind] ?? t.kind}</b>
              <span className="sub" style={{ display: "block", fontSize: 12 }}>{new Date(t.createdAt).toLocaleString("pt-BR")}</span>
            </span>
            <span style={{ fontWeight: 600, color: t.amountCents >= 0 ? "var(--ok)" : "var(--cromo)", fontVariantNumeric: "tabular-nums" }}>
              {t.amountCents >= 0 ? "+" : "−"}{money(Math.abs(t.amountCents))}
            </span>
          </div>
        ))}
      </div>
      <Nav />
    </>
  );
}
