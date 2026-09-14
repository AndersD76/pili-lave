"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setToken, type Me } from "../client";

export default function Cadastro() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const r = await api<{ token: string; user: Me }>("/api/auth/register", {
        body: { name, phone, email, password, confirmPassword }, auth: false,
      });
      setToken(r.token);
      // primeiro acesso: onboarding antes de cair na home
      router.replace("/app/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar sua conta");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16, justifyContent: "center", minHeight: "70dvh" }}>
      <div>
        <div className="pw-logo">PILI LAVE<span>.</span></div>
        <p className="sub">Crie sua conta para começar.</p>
      </div>
      <input
        className="field" placeholder="Nome completo" autoComplete="name"
        value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80}
      />
      <input
        className="field" type="tel" inputMode="tel" placeholder="(54) 99999-9999" autoComplete="tel"
        value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={16}
      />
      <input
        className="field" type="email" inputMode="email" placeholder="seu@email.com" autoComplete="email"
        value={email} onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="field" type="password" placeholder="Senha (mín. 8 caracteres, letras e números)" autoComplete="new-password"
        value={password} onChange={(e) => setPassword(e.target.value)}
      />
      <input
        className="field" type="password" placeholder="Confirmar senha" autoComplete="new-password"
        value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
      />
      {error && <p className="err">{error}</p>}
      <button className="btn" disabled={loading || !name || !phone || !email || !password || !confirmPassword}>
        {loading ? "Criando conta…" : "Criar conta"}
      </button>
      <Link className="sub" href="/app/login" style={{ textAlign: "center" }}>Já tenho uma conta</Link>
    </form>
  );
}
