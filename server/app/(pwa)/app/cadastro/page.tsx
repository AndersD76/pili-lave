"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setToken, type Me, type TipoParceiro } from "../client";
import { Logo } from "../Logo";

const OPCOES_TIPO: { k: TipoParceiro; label: string }[] = [
  { k: "LAVADOR", label: "Sou lavador" },
  { k: "COMISSAO1", label: "Sou vendedor 1" },
  { k: "COMISSAO2", label: "Sou vendedor 2" },
  { k: "ALUGUEL", label: "Recebo aluguel" },
  { k: "DONO_LOJA", label: "Sou dono de loja de conveniência" },
];

export default function Cadastro() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [nascimento, setNascimento] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [tiposSolicitados, setTiposSolicitados] = useState<TipoParceiro[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  function alternarTipo(tipo: TipoParceiro) {
    setTiposSolicitados((atual) => (atual.includes(tipo) ? atual.filter((t) => t !== tipo) : [...atual, tipo]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const r = await api<{ token: string; user: Me }>("/api/auth/register", {
        body: { name, phone, email, nascimento, password, confirmPassword, tiposSolicitados },
        auth: false,
      });
      setToken(r.token);
      // o onboarding (da lavagem) aparece na primeira vez que escolher a lavagem
      localStorage.setItem("pililave_onboarding_pendente", "1");
      if (tiposSolicitados.length > 0) {
        const labels = tiposSolicitados.map((t) => OPCOES_TIPO.find((o) => o.k === t)?.label).join(", ");
        setAviso(`Pedido enviado (${labels}). Você já pode usar o app como cliente enquanto o admin aprova.`);
        setTimeout(() => router.replace("/app/termos"), 2500);
        return;
      }
      // primeiro acesso: termo de uso → escolha (loja ou lavagem)
      router.replace("/app/termos");
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
      <label>
        <span className="sub">Data de nascimento</span>
        <input
          className="field" type="date" autoComplete="bday"
          value={nascimento} onChange={(e) => setNascimento(e.target.value)}
        />
      </label>
      <input
        className="field" type="password" placeholder="Senha (mín. 8 caracteres, letras e números)" autoComplete="new-password"
        value={password} onChange={(e) => setPassword(e.target.value)}
      />
      <input
        className="field" type="password" placeholder="Confirmar senha" autoComplete="new-password"
        value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
      />
      <div>
        <p className="sub" style={{ marginBottom: 8 }}>
          Também é lavador, vendedor ou recebe aluguel de alguma máquina? (opcional, pode marcar mais de um)
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {OPCOES_TIPO.map((op) => (
            <label key={op.k} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={tiposSolicitados.includes(op.k)} onChange={() => alternarTipo(op.k)} />
              {op.label}
            </label>
          ))}
        </div>
        {tiposSolicitados.length > 0 && (
          <p className="sub" style={{ marginTop: 6 }}>
            Fica pendente de aprovação do admin — você usa o app como cliente enquanto isso.
          </p>
        )}
      </div>
      {aviso && <p className="sub">{aviso}</p>}
      {error && <p className="err">{error}</p>}
      <button className="btn" disabled={loading || !name || !phone || !email || !nascimento || !password || !confirmPassword}>
        {loading ? "Criando conta…" : "Criar conta"}
      </button>
      <Link className="sub" href="/app/login" style={{ textAlign: "center" }}>Já tenho uma conta</Link>
    </form>
  );
}
