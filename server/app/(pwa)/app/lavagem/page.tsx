"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useEffect, useState } from "react";
import { api, money, type Me, type Order, type Program } from "../client";

type Saude = { disponivel: boolean; motivo: string | null; cameraOffline: boolean };

/** Compra da lavagem. Dois caminhos: pagar e esperar a câmera reconhecer a
 *  placa na chegada, ou "já estou na máquina" — libera na hora, para quando
 *  a câmera não reconhecer (ou estiver fora do ar). */
function NovaLavagemConteudo() {
  const router = useRouter();
  const params = useSearchParams();
  const stationId = params.get("stationId");
  const stationName = params.get("stationName");
  const [programs, setPrograms] = useState<Program[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saude, setSaude] = useState<Saude | null>(null);

  useEffect(() => {
    if (!stationId) return;
    const qs = `?stationId=${encodeURIComponent(stationId)}`;
    api<Program[]>(`/api/programs${qs}`, { auth: false }).then((ps) => {
      setPrograms(ps);
      // veio de "repetir a última": já deixa escolhido
      const pre = Number(params.get("programa"));
      if (pre && ps.some((x) => x.id === pre)) setSel(pre);
    }).catch(() => {});
    api<Me>("/api/me").then(setMe).catch(() => router.replace("/app/login"));
    // saúde da máquina: não deixa pagar por lavagem que não vai acontecer
    const verSaude = () => api<Saude>("/api/saude", { auth: false }).then(setSaude).catch(() => {});
    verSaude();
    const t = setInterval(verSaude, 20000);
    return () => clearInterval(t);
  }, [router, stationId, params]);

  if (!stationId) {
    return (
      <>
        <h1>Escolha a unidade primeiro</h1>
        <p className="sub">Cada unidade tem seu próprio preço — selecione onde você vai lavar.</p>
        <Link className="btn" href="/app/unidades">Ver unidades</Link>
      </>
    );
  }

  const selected = programs.find((p) => p.id === sel);
  const falta = selected && me ? selected.precoCents - me.walletCents : 0;

  async function comprar(jaEstouNaMaquina = false) {
    if (!selected) return;
    setError(""); setLoading(true);
    try {
      await api<Order>("/api/orders", {
        body: { programId: selected.id, jaEstouNaMaquina, stationId },
      });
      /* Volta para a tela inicial: é lá que está o acompanhamento da
       * lavagem (status da máquina, progresso, câmera ao vivo e o botão
       * de liberar sem a câmera). O voucher só interessa no fluxo antigo,
       * de mostrar o QR ao lavador. */
      router.replace("/app");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir");
      setLoading(false);
    }
  }

  return (
    <>
      <h1>Nova lavagem</h1>
      {stationName && <p className="sub">Unidade: {stationName}</p>}
      <p className="sub">Saldo: {me ? money(me.walletCents) : "…"}</p>

      {saude && !saude.disponivel && (
        <div className="card" style={{ borderColor: "var(--erro)" }}>
          <div className="lab" style={{ color: "var(--erro)" }}>Máquina não disponível</div>
          <p className="sub">{saude.motivo ?? "Tente novamente em alguns minutos."}</p>
        </div>
      )}
      {saude?.disponivel && saude.cameraOffline && (
        <div className="card" style={{ borderColor: "var(--atencao)" }}>
          <div className="lab" style={{ color: "var(--atencao)" }}>Câmera fora do ar</div>
          <p className="sub">A placa não será reconhecida sozinha. Use &quot;Já estou na máquina&quot; ao chegar.</p>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {programs.map((p) => (
          <button key={p.id} type="button" className={`opt${sel === p.id ? " sel" : ""}`} onClick={() => setSel(p.id)}>
            <span style={{ display: "flex", flexDirection: "column", width: "100%", gap: 4, textAlign: "left" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="nome" style={{ flex: 1, minWidth: 0 }}>{p.id} · {p.nome}</span>
                <span className="preco" style={{ flexShrink: 0 }}>{money(p.precoCents)}</span>
              </span>
              {p.descricao && <span className="sub" style={{ fontSize: 13 }}>{p.descricao}</span>}
            </span>
          </button>
        ))}
      </div>
      {error && <p className="err">{error}</p>}
      {selected && falta > 0 ? (
        <>
          <p className="err">Saldo insuficiente — faltam {money(falta)}.</p>
          <Link className="btn" href="/app/recarga">Adicionar saldo</Link>
        </>
      ) : (
        <>
          <button
            className="btn"
            onClick={() => comprar(false)}
            disabled={!selected || loading || saude?.disponivel === false}
          >
            {loading ? "Processando…" : selected ? `Pagar ${money(selected.precoCents)} com saldo` : "Escolha o tipo"}
          </button>
          {/* Saída para quando a câmera não reconhecer: o cliente já está na
              máquina e libera na hora, sem depender da leitura da placa. */}
          <button
            className="btn ghost"
            onClick={() => comprar(true)}
            disabled={!selected || loading || saude?.disponivel === false}
          >
            Já estou na máquina — pagar e liberar agora
          </button>
          <p className="sub center" style={{ fontSize: 13 }}>
            Pagando normal, a máquina libera sozinha quando a câmera ler sua placa.
          </p>
        </>
      )}
    </>
  );
}

/* useSearchParams (usado para o atalho "repetir a última lavagem") precisa
 * de Suspense, senão a geração estática da página falha no build. */
export default function NovaLavagem() {
  return (
    <Suspense fallback={<p className="sub">Carregando…</p>}>
      <NovaLavagemConteudo />
    </Suspense>
  );
}
