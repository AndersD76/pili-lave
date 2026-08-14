"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, setToken, type Me } from "../client";

export default function Otp() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const p = sessionStorage.getItem("pl_phone");
    if (!p) router.replace("/app/login");
    else setPhone(p);
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const r = await api<{ token: string; user: Me }>("/api/auth/otp/verify", {
        body: { phone, code }, auth: false,
      });
      setToken(r.token);
      router.replace("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Código incorreto");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16, justifyContent: "center", minHeight: "70dvh" }}>
      <h1>Digite o código</h1>
      <p className="sub">Enviamos um SMS para {phone}.</p>
      <input
        className="field big" inputMode="numeric" placeholder="000000" maxLength={6}
        value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus
      />
      {error && <p className="err">{error}</p>}
      <button className="btn" disabled={loading || code.length !== 6}>
        {loading ? "Verificando…" : "Entrar"}
      </button>
    </form>
  );
}
