"use client";

/** Estados da reserva que o app acompanha. */
export type StatusLavagem = "HELD" | "ACTIVE" | "ENTERED" | "COMPLETED" | "FAILED" | "EXPIRED" | null;

const PASSOS = [
  { chave: "HELD", titulo: "Pagamento confirmado", ajuda: "Sua lavagem está reservada." },
  { chave: "ACTIVE", titulo: "Carro reconhecido", ajuda: "Luz verde — pode entrar na máquina." },
  { chave: "ENTERED", titulo: "Lavando", ajuda: "A máquina está lavando o seu carro." },
  { chave: "COMPLETED", titulo: "Pronto", ajuda: "Pode sair. Tenha um bom dia!" },
] as const;

/**
 * Onde a lavagem está, em etapas — em vez de uma frase solta que não diz o
 * que já passou nem o que falta.
 */
export type EtapasLavagem = { itens: string[]; atual: number | null };

export function ProgressoLavagem({ status, etapas }: { status: StatusLavagem; etapas?: EtapasLavagem | null }) {
  if (!status || status === "EXPIRED") return null;

  if (status === "FAILED")
    return (
      <div className="card" style={{ borderColor: "var(--erro)" }}>
        <div className="lab" style={{ color: "var(--erro)" }}>Lavagem interrompida</div>
        <p className="sub">A máquina apresentou falha. O valor foi devolvido ao seu saldo.</p>
      </div>
    );

  const atual = PASSOS.findIndex((p) => p.chave === status);
  const cor = status === "COMPLETED" ? "var(--ok)" : "var(--jato)";

  return (
    <div className="card" style={{ borderColor: cor, borderWidth: 2 }}>
      <div className="lab" style={{ color: cor }}>
        {status === "COMPLETED" ? "Lavagem finalizada" : "Lavagem em andamento"}
      </div>
      <div className="etapas">
        {PASSOS.map((p, i) => {
          const feito = i < atual || status === "COMPLETED";
          const agora = i === atual && status !== "COMPLETED";
          return (
            <div key={p.chave} className={`passo${feito ? " feito" : ""}${agora ? " agora" : ""}`}>
              <span className="bola">{feito ? "✓" : i + 1}</span>
              <span className="txt">
                {p.titulo}
                {agora && <><br /><span className="sub" style={{ fontSize: 13 }}>{p.ajuda}</span></>}
                {agora && p.chave === "ENTERED" && etapas && etapas.itens.length > 0 && <ListaEtapas etapas={etapas} />}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Tarefas da lavagem escolhida, com a que a máquina está fazendo agora marcada: ✓ já feita · ● em andamento · ○ falta. */
function ListaEtapas({ etapas }: { etapas: EtapasLavagem }) {
  const { itens, atual } = etapas;
  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="sub" style={{ fontSize: 13 }}>
        {atual === null ? `${itens.length} etapas — começando…` : `Etapa ${atual + 1} de ${itens.length}`}
      </span>
      {itens.map((nome, i) => {
        const feita = atual !== null && i < atual;
        const agora = atual !== null && i === atual;
        return (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 10,
            background: agora ? "rgba(255,255,255,0.08)" : "transparent",
            opacity: feita ? 0.55 : 1,
            fontWeight: agora ? 700 : 400,
            color: agora ? "var(--jato)" : "inherit",
          }}>
            <span style={{ width: 18, textAlign: "center" }}>{feita ? "✓" : agora ? "●" : "○"}</span>
            <span>{nome}</span>
            {agora && <span className="sub" style={{ marginLeft: "auto", fontSize: 12 }}>agora</span>}
          </div>
        );
      })}
    </div>
  );
}
