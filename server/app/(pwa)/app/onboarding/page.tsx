"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "../Logo";

const PASSOS = [
  {
    titulo: "Reserve pelo app",
    texto: "Escolha o tipo de lavagem e pague com seu saldo — a reserva fica valendo por 1 hora.",
  },
  {
    titulo: "A câmera reconhece sua placa",
    texto: "Chegando na máquina, a câmera identifica seu carro sozinha e acende o verde para você entrar.",
  },
  {
    titulo: "Câmera não reconheceu? Sem problema",
    texto: "Toque em \"Cheguei\" na tela da sua reserva para liberar manualmente. O valor só é cobrado quando a lavagem termina.",
  },
];

/** Primeiro acesso: Cadastro → Login automático → Onboarding → Créditos. */
export default function Onboarding() {
  const router = useRouter();
  const [passo, setPasso] = useState(0);
  const ultimo = passo === PASSOS.length - 1;
  const atual = PASSOS[passo];

  function avancar() {
    if (ultimo) router.replace("/app/recarga");
    else setPasso((p) => p + 1);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, justifyContent: "center", minHeight: "70dvh" }}>
      <Logo />
      <div className="card">
        <div className="lab">{passo + 1} de {PASSOS.length}</div>
        <h1 style={{ margin: "8px 0" }}>{atual.titulo}</h1>
        <p className="sub">{atual.texto}</p>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        {PASSOS.map((_, i) => (
          <span
            key={i}
            style={{
              width: 8, height: 8, borderRadius: 999,
              background: i === passo ? "var(--jato)" : "var(--linha)",
            }}
          />
        ))}
      </div>
      <button className="btn" onClick={avancar}>
        {ultimo ? "Adicionar créditos" : "Próximo"}
      </button>
    </div>
  );
}
