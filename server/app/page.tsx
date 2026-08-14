export default function Home() {
  const card: React.CSSProperties = {
    display: "block", padding: "22px 24px", borderRadius: 18,
    background: "linear-gradient(180deg, var(--verniz3) 0%, var(--verniz2) 26%)",
    border: "1px solid var(--linha)", textDecoration: "none",
  };
  return (
    <main style={{ maxWidth: 560, margin: "10vh auto 0", padding: 24, display: "grid", gap: 14 }}>
      <h1 style={{ fontSize: 44, fontWeight: 800 }}>
        PILI LAVE<span style={{ color: "var(--pili)" }}>.</span>
      </h1>
      <p style={{ color: "var(--aco-d)", marginBottom: 10 }}>Lavagem sem fila.</p>

      <a href="/app" style={card}>
        <b style={{ fontSize: 20, color: "var(--jato)" }}>Abrir o app →</b>
        <span style={{ display: "block", color: "var(--aco-d)", fontSize: 14, marginTop: 4 }}>
          Para o cliente: cadastro, saldo, lavagens. No celular, use
          &quot;Adicionar à tela inicial&quot; para instalar.
        </span>
      </a>
      <a href="/camera" style={card}>
        <b style={{ fontSize: 20, color: "var(--cromo)" }}>Câmera da máquina →</b>
        <span style={{ display: "block", color: "var(--aco-d)", fontSize: 14, marginTop: 4 }}>
          Para o celular fixo na máquina: lê a placa e vira o painel de luz.
        </span>
      </a>
      <a href="/admin" style={card}>
        <b style={{ fontSize: 20, color: "var(--cromo)" }}>Painel admin →</b>
        <span style={{ display: "block", color: "var(--aco-d)", fontSize: 14, marginTop: 4 }}>
          Contagens, lavagens, usuários e lavadores.
        </span>
      </a>
    </main>
  );
}
