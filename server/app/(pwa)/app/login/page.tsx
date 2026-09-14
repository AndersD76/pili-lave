"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setToken, type Me } from "../client";
import { Logo } from "../Logo";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const r = await api<{ token: string; user: Me }>("/api/auth/login", {
        body: { email, password }, auth: false,
      });
      setToken(r.token);
      router.replace("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16, justifyContent: "center", minHeight: "70dvh" }}>
      <div>
        <Logo />
        <p className="sub">Entre com seu e-mail e senha.</p>
      </div>
      <input
        className="field" type="email" inputMode="email" placeholder="seu@email.com" autoComplete="email"
        value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
      />
      <input
        className="field" type="password" placeholder="Senha" autoComplete="current-password"
        value={password} onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="err">{error}</p>}
      <button className="btn" disabled={loading || !email || !password}>
        {loading ? "Entrando…" : "Entrar"}
      </button>
      <Link className="sub" href="/app/cadastro" style={{ textAlign: "center" }}>Criar conta</Link>
    </form>
  );
}
