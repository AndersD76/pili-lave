"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api, getToken, money, type Me } from "../../client";
import { Logo } from "../../Logo";

/** Pede um token novo um pouco antes de vencer (o token dura 180s no
 *  servidor) — assim quem ficar parado na tela não vê o QR morrer na mão. */
const RENOVA_A_CADA_MS = 150_000;

/**
 * QR de pagamento da loja: o caixa escaneia (mesmo leitor dos produtos) e
 * debita da carteira. Cada QR vale por pouco tempo e se renova sozinho
 * enquanto a tela ficar aberta.
 */
export default function PagarNaLoja() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [erro, setErro] = useState("");
  const gerando = useRef(false);

  useEffect(() => {
    if (!getToken()) { router.replace("/app/cadastro"); return; }
    api<Me>("/api/me").then(setMe).catch(() => router.replace("/app/login"));
  }, [router]);

  useEffect(() => {
    async function gerar() {
      if (gerando.current) return;
      gerando.current = true;
      try {
        const r = await api<{ token: string }>("/api/loja/pagamento/token", { body: {} });
        setQrUrl(await QRCode.toDataURL(`PILILOJA:${r.token}`, { width: 420, margin: 1 }));
        setErro("");
      } catch {
        setErro("Não foi possível gerar o código. Confira sua conexão e tente de novo.");
      } finally {
        gerando.current = false;
      }
    }
    gerar();
    const t = setInterval(gerar, RENOVA_A_CADA_MS);
    return () => clearInterval(t);
  }, []);

  if (!me) return <p className="sub">Carregando…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", textAlign: "center" }}>
      <Logo />
      <h1>Pagar na loja</h1>
      <p className="sub">Mostre este código no leitor do caixa para pagar com o saldo da sua carteira.</p>
      <div className="card" style={{ padding: 20 }}>
        {qrUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrUrl} alt="Código para pagar na loja" width={240} height={240} />
        ) : (
          <div style={{ width: 240, height: 240, display: "grid", placeItems: "center" }}>
            <span className="sub">Gerando…</span>
          </div>
        )}
      </div>
      {erro && <p className="err">{erro}</p>}
      <div className="card" style={{ width: "100%" }}>
        <div className="lab">Saldo disponível</div>
        <div className="money"><span className="cur">R$</span>{money(me.walletCents).replace("R$ ", "")}</div>
      </div>
      <p className="sub">O código muda a cada 3 minutos por segurança — deixe a tela aberta até terminar de pagar.</p>
      <Link className="btn ghost" href="/app/loja">Voltar</Link>
    </div>
  );
}
