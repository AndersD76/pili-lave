"use client";
/**
 * CAPTURAS DA CÂMERA — diagnóstico ao vivo.
 * Mostra as últimas fotos que a ESP32-CAM mandou, o que a nuvem leu e a
 * confiança. Atualiza sozinha a cada 4 s.
 */
import { useEffect, useState } from "react";
import "../app/pwa.css";

type Meta = {
  id: string; at: string; bytes: number;
  plate: string | null; score: number | null; status: string | null;
  light: string | null; note: string | null; clientName: string | null;
};

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export default function Capturas() {
  const [frames, setFrames] = useState<Meta[]>([]);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch("/api/lpr/frames", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (alive) { setFrames(await r.json()); setErr(""); }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "falha");
      }
    }
    load();
    const t = setInterval(() => { load(); setTick((x) => x + 1); }, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="pw" style={{ maxWidth: 1100 }}>
      <div className="pw-logo">PILI LAVE<span>.</span> Capturas da câmera</div>
      <p className="sub">Últimas fotos recebidas da ESP32-CAM e o que a nuvem leu. Atualiza a cada 4 s.</p>
      {err && <p className="err">Não consegui carregar: {err}</p>}
      {frames.length === 0 && !err && <p className="sub">Nenhuma captura ainda — aguardando a câmera detectar uma chegada.</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
        {frames.map((f) => {
          const ok = f.plate && f.status && f.status !== "NO_MATCH";
          const cls = f.plate ? (ok ? "ok" : "at") : "off";
          return (
            <div key={f.id} className="card" style={{ padding: 10 }}>
              <img
                src={`/api/lpr/frame?id=${f.id}`}
                alt={f.plate ?? "sem placa"}
                style={{ width: "100%", borderRadius: 12, display: "block", background: "#000" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 8 }}>
                <span className={`chip ${cls}`}>
                  {f.plate ? f.plate : "sem placa"}
                  {f.score != null ? ` · ${Math.round(f.score * 100)}%` : ""}
                </span>
                <span className="sub" style={{ fontSize: 12 }}>{hora(f.at)} · {Math.round(f.bytes / 1024)} KB</span>
              </div>
              <div className="sub" style={{ fontSize: 12, marginTop: 4 }}>
                {f.clientName ? `${f.clientName} · ` : ""}{f.status ?? ""}{f.light ? ` · luz ${f.light}` : ""}{f.note ? ` · ${f.note}` : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
