"use client";
/**
 * CÂMERA DA MÁQUINA (modo teste com celular)
 * -------------------------------------------------
 * Abra esta página no celular apontado para a chegada dos carros:
 *  1. Lê a placa pela câmera (OCR no navegador) — ou digitação manual.
 *  2. Envia para a nuvem (/api/lpr/read) → identifica o usuário e o saldo.
 *  3. Mostra na tela a mensagem para o motorista (cadastrado / sem saldo / desconhecido).
 *  4. Faz o papel da máquina: polling em /api/machine/next → LUZ VERDE + ack.
 * Requer a chave de dispositivo (DEVICE_KEY) — pedida no primeiro uso.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createWorker, type Worker } from "tesseract.js";
import "../app/pwa.css";

const PLATE_RE = /[A-Z]{3}[0-9](?:[A-Z][0-9]{2}|[0-9]{3})/g;

type LprResp = {
  arrivalId: string; status: string; match?: boolean;
  clientName?: string | null; saldoOk?: boolean; dedup?: boolean;
};
type Job = { arrivalId: string; plate: string; programId: number; programa: string };

type Panel =
  | { kind: "idle" }
  | { kind: "hello"; plate: string; name: string | null; saldoOk: boolean }
  | { kind: "unknown"; plate: string }
  | { kind: "green"; job: Job };

export default function CameraMaquina() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const lastSent = useRef<{ plate: string; at: number }>({ plate: "", at: 0 });
  const candidate = useRef<{ plate: string; hits: number }>({ plate: "", hits: 0 });
  const panelRef = useRef<Panel>({ kind: "idle" });

  const [key, setKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [panel, setPanelState] = useState<Panel>({ kind: "idle" });
  const [manual, setManual] = useState("");
  const [ocrOn, setOcrOn] = useState(false);
  const [err, setErr] = useState("");

  const setPanel = useCallback((p: Panel) => { panelRef.current = p; setPanelState(p); }, []);

  useEffect(() => {
    const k = localStorage.getItem("pl_devkey");
    if (k) { setKey(k); setKeySaved(true); }
  }, []);

  const devFetch = useCallback(async (path: string, body?: unknown) => {
    const res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "x-device-key": localStorage.getItem("pl_devkey") ?? "" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error ?? `Erro ${res.status}`);
    return json;
  }, []);

  const sendPlate = useCallback(async (plateRaw: string) => {
    const plate = plateRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const now = Date.now();
    if (lastSent.current.plate === plate && now - lastSent.current.at < 30_000) return; // anti-flood
    lastSent.current = { plate, at: now };
    setErr("");
    try {
      const r = (await devFetch("/api/lpr/read", { plate })) as LprResp;
      if (r.status === "NO_MATCH") setPanel({ kind: "unknown", plate });
      else setPanel({ kind: "hello", plate, name: r.clientName ?? null, saldoOk: r.saldoOk ?? false });
      setTimeout(() => { if (panelRef.current.kind !== "green") setPanel({ kind: "idle" }); }, 20_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao enviar placa");
    }
  }, [devFetch, setPanel]);

  /* ===== papel da máquina: polling da liberação + luz verde ===== */
  useEffect(() => {
    if (!keySaved) return;
    const t = setInterval(async () => {
      try {
        const r = (await devFetch("/api/machine/next")) as { job: Job | null };
        if (r.job && panelRef.current.kind !== "green") {
          const job = r.job;
          setPanel({ kind: "green", job });
          setTimeout(() => devFetch("/api/machine/ack", { arrivalId: job.arrivalId }).catch(() => {}), 1500);
          setTimeout(() => setPanel({ kind: "idle" }), 18_000);
        }
      } catch { /* segue */ }
    }, 2500);
    return () => clearInterval(t);
  }, [keySaved, devFetch, setPanel]);

  /* ===== câmera + OCR ===== */
  useEffect(() => {
    if (!keySaved || !ocrOn) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false,
        });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const worker = await createWorker("eng");
        await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" });
        workerRef.current = worker;
        if (stopped) return;
        timer = setInterval(async () => {
          const vid = videoRef.current;
          if (!vid || vid.readyState !== 4) return;
          // faixa central (onde a placa costuma estar)
          const W = vid.videoWidth, H = vid.videoHeight;
          canvas.width = W; canvas.height = Math.floor(H * 0.4);
          ctx.drawImage(vid, 0, H * 0.3, W, H * 0.4, 0, 0, W, canvas.height);
          try {
            const { data } = await worker.recognize(canvas);
            const text = (data.text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            const found = text.match(PLATE_RE)?.[0];
            if (found) {
              if (candidate.current.plate === found) candidate.current.hits++;
              else candidate.current = { plate: found, hits: 1 };
              if (candidate.current.hits >= 2) { // confirma em 2 leituras
                candidate.current.hits = 0;
                sendPlate(found);
              }
            }
          } catch { /* frame ruim */ }
        }, 1300);
      } catch {
        setErr("Sem acesso à câmera — use a digitação manual abaixo.");
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [keySaved, ocrOn, sendPlate]);

  /* ===== telas ===== */
  if (!keySaved)
    return (
      <div className="pw" style={{ justifyContent: "center" }}>
        <div className="pw-logo">PILI LAVE<span>.</span> Câmera</div>
        <p className="sub">Cole a chave de dispositivo (DEVICE_KEY do servidor).</p>
        <input className="field" value={key} onChange={(e) => setKey(e.target.value)} placeholder="dev_..." />
        <button className="btn" disabled={key.length < 10}
          onClick={() => { localStorage.setItem("pl_devkey", key.trim()); setKeySaved(true); }}>
          Salvar e iniciar
        </button>
      </div>
    );

  const fullscreen = (bg: string, cls: string, children: React.ReactNode) => (
    <div className={cls} style={{ minHeight: "100dvh", background: bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, textAlign: "center" }}>
      <style>{`
        @keyframes pl-blink { 0%,49% { background: var(--ok); } 50%,100% { background: var(--erro); } }
        .pl-blink { animation: pl-blink 1s step-end infinite; }
        @media (prefers-reduced-motion: reduce) { .pl-blink { animation: none; background: var(--atencao) !important; } }
      `}</style>
      {children}
    </div>
  );
  const big = (t: string, color: string) => (
    <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 36, color }}>{t}</div>
  );
  const sub2 = (t: string, color: string) => (
    <div style={{ fontSize: 18, color, maxWidth: 420 }}>{t}</div>
  );

  /* LUZ VERDE contínua — lavagem paga e liberada */
  if (panel.kind === "green")
    return fullscreen("var(--ok)", "", (
      <>
        {big("LUZ VERDE", "#052e1c")}
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "#052e1c" }}>
          Lavagem {panel.job.programId} · {panel.job.programa}
        </div>
        <div style={{ fontSize: 20, letterSpacing: 4, color: "#052e1c", fontWeight: 600 }}>{panel.job.plate}</div>
        {sub2("Pode entrar. Boa lavagem!", "#052e1c")}
      </>
    ));

  /* LUZ VERMELHA contínua — placa sem cadastro */
  if (panel.kind === "unknown")
    return fullscreen("var(--erro)", "", (
      <>
        {big("LUZ VERMELHA", "#3d0705")}
        <div style={{ fontSize: 20, letterSpacing: 4, color: "#3d0705", fontWeight: 600 }}>{panel.plate}</div>
        {sub2("Você ainda não é cadastrado — baixe o app PILI LAVE, cadastre seu carro e insira saldo.", "#3d0705")}
      </>
    ));

  /* VERDE+VERMELHA piscando — cadastrado sem saldo */
  if (panel.kind === "hello" && !panel.saldoOk)
    return fullscreen("var(--erro)", "pl-blink", (
      <>
        {big("SALDO INSUFICIENTE", "#0b1418")}
        <div style={{ fontSize: 20, letterSpacing: 4, color: "#0b1418", fontWeight: 600 }}>{panel.plate}</div>
        {sub2("Abra o app e adicione saldo para liberar a lavagem.", "#0b1418")}
      </>
    ));

  /* VERDE contínua — reconhecido com saldo, aguardando o motorista pedir */
  if (panel.kind === "hello")
    return fullscreen("var(--ok)", "", (
      <>
        {big(`Olá${panel.name ? `, ${panel.name.split(" ")[0]}` : ""}!`, "#052e1c")}
        <div style={{ fontSize: 20, letterSpacing: 4, color: "#052e1c", fontWeight: 600 }}>{panel.plate}</div>
        {sub2("Abra o app PILI LAVE e toque em Solicitar lavagem.", "#052e1c")}
      </>
    ));

  /* estado ocioso: câmera + entrada manual */
  return (
    <div className="pw">
      <div className="pw-logo">PILI LAVE<span>.</span> Câmera da máquina</div>

      {ocrOn ? (
        <>
          <video ref={videoRef} className="cam" muted playsInline />
          <p className="sub center">Aponte para a placa do carro. Confirmo após 2 leituras iguais.</p>
          <button className="btn ghost" onClick={() => setOcrOn(false)}>Pausar câmera</button>
        </>
      ) : (
        <button className="btn" onClick={() => setOcrOn(true)}>Ligar câmera (OCR)</button>
      )}

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="lab">Ou digite a placa (teste manual)</div>
        <input className="field big" style={{ letterSpacing: 6 }} placeholder="ABC1D23" maxLength={8}
          value={manual} onChange={(e) => setManual(e.target.value.toUpperCase())} />
        <button className="btn ghost" disabled={manual.replace(/[^A-Z0-9]/g, "").length < 7}
          onClick={() => { sendPlate(manual); setManual(""); }}>
          Enviar placa
        </button>
      </div>
      {err && <p className="err">{err}</p>}
      <p className="sub center" style={{ fontSize: 12 }}>
        Esta página também simula a máquina: quando o motorista pagar, a tela vira a LUZ VERDE.
      </p>
    </div>
  );
}
