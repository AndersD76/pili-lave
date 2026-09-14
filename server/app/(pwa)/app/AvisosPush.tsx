"use client";
import { useEffect, useState } from "react";
import { api, getToken } from "./client";

/** base64 (url-safe) -> bytes, formato que o navegador exige na inscrição. */
function paraBytes(base64: string): ArrayBuffer {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

/**
 * Liga/desliga os avisos no celular. O cliente não fica com o app aberto
 * esperando — sem isso ele só descobre a luz verde se olhar a tela na hora.
 */
export function AvisosPush() {
  const [suportado, setSuportado] = useState(false);
  const [ligado, setLigado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const ok = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
    setSuportado(ok);
    if (!ok) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setLigado(!!sub))
      .catch(() => {});
  }, []);

  async function ligar() {
    setErro(""); setOcupado(true);
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== "granted") {
        setErro("Você bloqueou os avisos. Libere nas configurações do navegador.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const { chave } = await api<{ chave: string }>("/api/push", { auth: false });
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: paraBytes(chave),
      });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api("/api/push", { body: { endpoint: j.endpoint, keys: j.keys } });
      setLigado(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível ativar");
    } finally {
      setOcupado(false);
    }
  }

  async function desligar() {
    setOcupado(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        });
        await sub.unsubscribe();
      }
      setLigado(false);
    } catch { /* já estava desligado */ }
    finally { setOcupado(false); }
  }

  if (!suportado) return null;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="lab">Avisos no celular</div>
      <p className="sub">
        {ligado
          ? "Ativados. Avisamos quando a luz verde acender e quando a lavagem terminar."
          : "Receba um aviso quando puder entrar e quando a lavagem terminar — mesmo com o app fechado."}
      </p>
      <button className={ligado ? "btn ghost" : "btn"} onClick={ligado ? desligar : ligar} disabled={ocupado}>
        {ocupado ? "Aguarde…" : ligado ? "Desativar avisos" : "Ativar avisos"}
      </button>
      {erro && <p className="err">{erro}</p>}
      {/* No iPhone só funciona com o app instalado na tela de início */}
      <p className="sub" style={{ fontSize: 12 }}>
        No iPhone, adicione o PILI LAVE à tela de início para receber avisos.
      </p>
    </div>
  );
}
