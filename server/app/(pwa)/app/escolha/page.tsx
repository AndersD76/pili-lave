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
  const [lavagem, setLavagem] = useState<string | null>(null);   // lavagem em andamento: vira um atalho, NAO um redirecionamento (o cliente pode deixar o carro lavando e ir a loja)

  useEffect(() => {
    if (!getToken()) { router.replace("/app/cadastro"); return; }
    api<Me>("/api/me")
      .then((m) => {
        if (!m.termosAceitos) { router.replace("/app/termos"); return; }
        /* O app instalado abre AQUI (start_url). Com uma lavagem em andamento
         * mostra um atalho em destaque para acompanhar — sem tirar a escolha:
         * quem deixa o carro lavando ainda precisa poder ir a loja. */
        api<{ arrival: { lavagem?: string | null; status?: string } | null }>("/api/arrivals/mine")
          .then((r) => {
            const a = r.arrival;
            if (!a) return;
            if (a.status === "WAITING_DRIVER") setLavagem("CHEGOU");
            else if (["HELD", "ACTIVE", "ENTERED"].includes(a.lavagem ?? "")) setLavagem(a.lavagem ?? null);
          })
          .catch(() => {});
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
      {lavagem && (
        <button className="opt" onClick={() => router.push("/app")} style={{ textAlign: "left", borderColor: "var(--jato)", borderWidth: 2 }}>
          <span className="nome" style={{ color: "var(--jato)" }}>
            {lavagem === "ENTERED" ? "Sua lavagem está em andamento"
              : lavagem === "CHEGOU" ? "Seu carro chegou na máquina"
              : "Você tem uma lavagem reservada"}
          </span>
          <span className="sub" style={{ display: "block" }}>Toque para acompanhar (ou cancelar). Você pode usar a loja enquanto isso.</span>
        </button>
      )}
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
