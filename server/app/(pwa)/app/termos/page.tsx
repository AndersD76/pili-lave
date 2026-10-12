"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TERMOS_TOPICOS, TERMOS_VERSAO } from "@/lib/termos";
import { api, getToken, type Me } from "../client";
import { Logo } from "../Logo";

/**
 * Termo de uso — obrigatório pra usar o app (as telas de entrada mandam
 * pra cá enquanto me.termosAceitos for falso). Quem se cadastrou antes da
 * data de nascimento existir preenche ela aqui também.
 */
export default function Termos() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [nascimento, setNascimento] = useState("");
  const [aceito, setAceito] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) { router.replace("/app/cadastro"); return; }
    api<Me>("/api/me").then(setMe).catch(() => router.replace("/app/login"));
  }, [router]);

  async function aceitar() {
    setError(""); setLoading(true);
    try {
      await api("/api/termos", { body: { versao: TERMOS_VERSAO, nascimento: nascimento || undefined } });
      router.replace("/app/escolha");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar o aceite");
    } finally {
      setLoading(false);
    }
  }

  if (!me) return <p className="sub">Carregando…</p>;
  const faltaNascimento = !me.nascimento;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Logo />
        <h1>Termo de uso</h1>
        <p className="sub">Para usar o app é preciso ler e aceitar o termo abaixo.</p>
      </div>
      {TERMOS_TOPICOS.map((t) => (
        <div className="card" key={t.titulo}>
          <div className="lab">{t.titulo}</div>
          <p className="sub">{t.texto}</p>
        </div>
      ))}
      <p className="sub">Versão: {TERMOS_VERSAO}</p>
      {faltaNascimento && (
        <label>
          <span className="lab">Data de nascimento</span>
          <input
            className="field" type="date" autoComplete="bday"
            value={nascimento} onChange={(e) => setNascimento(e.target.value)}
          />
        </label>
      )}
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} />
        Li e aceito o termo de uso
      </label>
      {error && <p className="err">{error}</p>}
      <button className="btn" onClick={aceitar} disabled={loading || !aceito || (faltaNascimento && !nascimento)}>
        {loading ? "Registrando…" : "Aceitar e continuar"}
      </button>
    </div>
  );
}
