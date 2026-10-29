/**
 * Faixa da Estação P3 — o hub do qual o PILI CLEAN faz parte.
 *
 * Ainda não há logo oficial da Estação P3, então a marca é montada em
 * texto no estilo placa de estação: "ESTAÇÃO" seguido do selo "P3".
 * Fica em tons neutros (branco/cinza) para não competir com o vermelho
 * do PILI CLEAN logo abaixo.
 *
 * A faixa vai de borda a borda: as margens negativas anulam o padding
 * do .pw, e o safe-area evita que a barra de status do iPhone cubra o
 * texto quando o app está instalado na tela inicial.
 */
export function FaixaEstacaoP3() {
  return (
    <header
      style={{
        margin: "-18px -18px 0",
        padding: "calc(14px + env(safe-area-inset-top)) 18px 14px",
        background: "var(--verniz2)",
        borderBottom: "1px solid var(--linha)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span
        aria-label="Estação P3"
        style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-display)", fontWeight: 800 }}
      >
        <span aria-hidden style={{ fontSize: 15, letterSpacing: "0.18em", color: "var(--cromo)" }}>ESTAÇÃO</span>
        <span
          aria-hidden
          style={{
            fontSize: 14, lineHeight: 1, padding: "5px 7px", borderRadius: 7,
            background: "var(--cromo)", color: "var(--verniz)",
          }}
        >
          P3
        </span>
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", color: "var(--aco-d)" }}>HUB</span>
    </header>
  );
}
