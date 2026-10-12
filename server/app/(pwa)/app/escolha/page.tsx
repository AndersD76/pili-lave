"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getToken, setToken, type Me } from "../client";
import { Logo } from "../Logo";

/** Marcada pelo cadastro: a primeira ida pra lavagem passa pelo onboarding. */
const ONBOARDING_PENDENTE = "pililave_onboarding_pendente";

/**
 * Porta de entrada do app: o cliente escolhe entre os dois produtos. A
 * lavagem continua exatamente como era (home em /app); a loja de
 * conveniência tem seu próprio caminho (/app/loja).
 */
export default function Escolha() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    if (!getToken()) { router.replace("/app/cadastro"); return; }
    api<Me>("/api/me")
      .then((m) => {
        if (!m.termosAceitos) { router.replace("/app/termos"); return; }
        setMe(m);
      })
      .catch(() => router.replace("/app/login"));
  }, [router]);

  function irLavagem() {
    if (localStorage.getItem(ONBOARDING_PENDENTE)) {
      localStorage.removeItem(ONBOARDING_PENDENTE);
      router.push("/app/onboarding");
    } else {
      router.push("/app");
    }
  }

  if (!me) return <p className="sub">Carregando…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, justifyContent: "center", minHeight: "70dvh" }}>
      <div>
        <Logo />
        <p className="sub">Olá{me.name ? `, ${me.name.split(" ")[0]}` : ""}. O que você quer usar agora?</p>
      </div>
      <button className="opt" onClick={() => router.push("/app/loja")} style={{ textAlign: "left" }}>
        <span className="nome">Loja conveniência</span>
        <span className="sub" style={{ display: "block" }}>Entre, pegue o que quiser e pague no caixa de autoatendimento.</span>
      </button>
      <button className="opt" onClick={irLavagem} style={{ textAlign: "left" }}>
        <span className="nome">Lavagem expressa</span>
        <span className="sub" style={{ display: "block" }}>Reserve pelo app e a máquina lava sozinha.</span>
      </button>
      {/* sair fica aqui também: quem só usa a loja nunca passa pelo Perfil
          (que mora na barra da lavagem). */}
      <p
        className="sub center" style={{ cursor: "pointer" }}
        onClick={() => { setToken(null); router.replace("/app/login"); }}
      >
        Sair da conta
      </p>
    </div>
  );
}
