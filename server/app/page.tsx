export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "18vh auto 0", padding: 24 }}>
      <h1 style={{ fontSize: 40, fontWeight: 800 }}>
        PILI LAVE<span style={{ color: "var(--pili)" }}>.</span>
      </h1>
      <p style={{ color: "var(--aco-d)", marginTop: 8 }}>
        Servidor do aplicativo. A API vive em <code>/api</code> e o painel em{" "}
        <a href="/admin">/admin</a>.
      </p>
    </main>
  );
}
