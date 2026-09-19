"use client";
import { Nav } from "../nav";

/** Mesma tela "em breve" do app nativo (mobile/(tabs)/planos.tsx) — clube
 * de assinatura com lavagens inclusas, ainda não lançado. */
export default function Planos() {
  return (
    <>
      <h1>Planos</h1>
      <div className="card">
        <div className="lab">Economize com planos mensais</div>
        <p className="sub">Lavagens inclusas todo mês.</p>
      </div>
      <div className="card" style={{ alignItems: "center", textAlign: "center", padding: "36px 20px" }}>
        <div style={{ fontSize: 34 }}>✨</div>
        <h2 style={{ marginTop: 14 }}>Planos em breve</h2>
        <p className="sub" style={{ marginTop: 8 }}>
          Estamos preparando clubes de assinatura com lavagens inclusas. Avisaremos você no app.
        </p>
      </div>
      <Nav />
    </>
  );
}
