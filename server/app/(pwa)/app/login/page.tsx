"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../client";

export default function Login() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const r = await api<{ phone: string }>("/api/auth/otp/request", { body: { phone }, auth: false });
      sessionStorage.setItem("pl_phone", r.phone);
      router.push("/app/otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar o código");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16, justifyContent: "center", minHeight: "70dvh" }}>
      <div>
        <div className="pw-logo">PILI LAVE<span>.</span></div>
        <p className="sub">Entre com seu celular. Enviamos um código por SMS.</p>
      </div>
      <input
        className="field" type="tel" inputMode="tel" placeholder="(54) 99999-9999"
        value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus maxLength={16}
      />
      {error && <p className="err">{error}</p>}
      <button className="btn" disabled={loading || phone.replace(/\D/g, "").length < 10}>
        {loading ? "Enviando…" : "Receber código"}
      </button>
    </form>
  );
}
