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
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  function loadWallet() {
    api<{ walletCents: number; txs: Tx[] }>("/api/wallet")
      .then((r) => { setSaldo(r.walletCents); setTxs(r.txs); })
      .catch(() => router.replace("/app/login"));
  }
  useEffect(() => { loadWallet(); return () => { if (poll.current) clearInterval(poll.current); }; }, []);

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
      {error && <p className="err">{error}</p>}
      <button className="btn" onClick={gerar} disabled={loading}>
        {loading ? "Gerando…" : `Gerar PIX de ${money(amount)}`}
      </button>
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
