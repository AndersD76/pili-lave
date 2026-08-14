"use client";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { api, fmtPlate, money } from "../client";

type RedeemResult = {
  ok: true;
  program: { id: number; nome: string };
  plate: string | null;
  clientName: string | null;
  amountCents: number;
};

/** Modo lavador (fallback): lê o QR do voucher do cliente com a câmera. */
export default function Scanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [result, setResult] = useState<RedeemResult | null>(null);
  const [error, setError] = useState("");
  const [camError, setCamError] = useState("");
  const busy = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" }, audio: false,
        });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        tick();
      } catch {
        setCamError("Não foi possível acessar a câmera. Verifique as permissões do navegador.");
      }
    }
    function tick() {
      const v = videoRef.current;
      if (v && v.readyState === 4 && !busy.current) {
        canvas.width = v.videoWidth; canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (qr?.data) onScan(qr.data);
      }
      raf = requestAnimationFrame(tick);
    }
    async function onScan(code: string) {
      busy.current = true;
      setError("");
      try {
        setResult(await api<RedeemResult>("/api/redeem", { body: { code } }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao validar");
        setTimeout(() => { setError(""); busy.current = false; }, 2500);
      }
    }
    start();
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (result)
    return (
      <div className="center" style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 30 }}>
        <div className="successbig">OK</div>
        <h1>Lavagem liberada</h1>
        <p style={{ color: "var(--jato)", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19 }}>
          {result.program.id} · {result.program.nome}
        </p>
        {result.plate && <p className="placa">{fmtPlate(result.plate)}</p>}
        <p className="sub">{result.clientName ?? "Cliente"} · {money(result.amountCents)}</p>
        <button className="btn" onClick={() => location.reload()}>Escanear próximo</button>
      </div>
    );

  return (
    <>
      <h1>Escanear voucher</h1>
      {camError ? <p className="err">{camError}</p> : (
        <>
          <video ref={videoRef} className="cam" muted playsInline />
          <p className="sub center">Aponte para o QR do cliente. A lavagem é validada na hora.</p>
        </>
      )}
      {error && <p className="err center">{error}</p>}
    </>
  );
}
