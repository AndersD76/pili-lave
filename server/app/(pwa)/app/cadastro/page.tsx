"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setToken, type Me } from "../client";
import { Logo } from "../Logo";

type TipoSolicitado = "" | "LAVADOR" | "COMISSAO1" | "COMISSAO2" | "ALUGUEL";

export default function Cadastro() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [tipoSolicitado, setTipoSolicitado] = useState<TipoSolicitado>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const r = await api<{ token: string; user: Me }>("/api/auth/register", {
        body: { name, phone, email, password, confirmPassword, tipoSolicitado: tipoSolicitado || undefined },
        auth: false,
      });
      setToken(r.token);
      if (r.user.cadastroPendente) {
        setAviso("Cadastro em análise! Você já pode usar o app como cliente enquanto o admin aprova seu pedido.");
        setTimeout(() => router.replace("/app/onboarding"), 2500);
        return;
      }
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
        <Logo />
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
      <label className="sub" style={{ display: "block" }}>
        Tipo de conta
        <select
          className="field" style={{ marginTop: 6 }}
          value={tipoSolicitado} onChange={(e) => setTipoSolicitado(e.target.value as TipoSolicitado)}
        >
          <option value="">Sou cliente</option>
          <option value="LAVADOR">Sou lavador</option>
          <option value="COMISSAO1">Sou vendedor 1</option>
          <option value="COMISSAO2">Sou vendedor 2</option>
          <option value="ALUGUEL">Recebo aluguel</option>
        </select>
        {tipoSolicitado && (
          <span style={{ display: "block", marginTop: 6 }}>
            Fica pendente de aprovação do admin — você usa o app como cliente enquanto isso.
          </span>
        )}
      </label>
      {aviso && <p className="sub">{aviso}</p>}
      {error && <p className="err">{error}</p>}
      <button className="btn" disabled={loading || !name || !phone || !email || !password || !confirmPassword}>
        {loading ? "Criando conta…" : "Criar conta"}
      </button>
      <Link className="sub" href="/app/login" style={{ textAlign: "center" }}>Já tenho uma conta</Link>
    </form>
  );
}
