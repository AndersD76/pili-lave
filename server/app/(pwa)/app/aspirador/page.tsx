"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, ApiError, money, type Me, type Station, type VacuumUse } from "../client";

function AspiradorConteudo() {
  const router = useRouter();
  const params = useSearchParams();
  const machineId = params.get("machineId");
  const [machine, setMachine] = useState<Station["machines"][number] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [use, setUse] = useState<VacuumUse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [restante, setRestante] = useState<number | null>(null);
  const [finalizado, setFinalizado] = useState(false);

  useEffect(() => {
    if (!machineId) return;
    api<{ stations: Station[] }>("/api/stations", { auth: false }).then(({ stations }) => {
      for (const st of stations) {
        const m = st.machines.find((x) => x.id === machineId);
        if (m) { setMachine(m); break; }
      }
    }).catch(() => {});
    api<Me>("/api/me").then(setMe).catch(() => router.replace("/app/login"));
  }, [machineId, router]);

  // Contagem local só pra feedback visual — o tempo real é controlado pelo
  // backend/display via heartbeat. Ao zerar, finaliza na hora e volta
  // sozinho pra Home (não depende do display confirmar).
  useEffect(() => {
    if (use?.status !== "ACTIVE" || !use.startedAt) return;
    const durationSec = use.durationSec;
    const tick = () => {
      const decorrido = Math.floor((Date.now() - new Date(use.startedAt!).getTime()) / 1000);
      const r = Math.max(0, durationSec - decorrido);
      setRestante(r);
      if (r <= 0) setFinalizado(true);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [use]);

  useEffect(() => {
    if (!finalizado) return;
    const t = setTimeout(() => router.replace("/app"), 5000);
    return () => clearTimeout(t);
  }, [finalizado, router]);

  async function comprar() {
    if (!machineId) return;
    setError(""); setLoading(true);
    try {
      const created = await api<VacuumUse>("/api/vacuum/buy", { body: { machineId } });
      setUse(created);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível comprar");
    } finally {
      setLoading(false);
    }
  }

  async function comecar() {
    if (!use) return;
    setError(""); setLoading(true);
    try {
      const updated = await api<VacuumUse>("/api/vacuum/start", { body: { vacuumUseId: use.id } });
      setUse(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível iniciar");
    } finally {
      setLoading(false);
    }
  }

  if (!machineId) {
    return (
      <>
        <h1>Aspirador de pó</h1>
        <p className="sub">Escolha uma unidade com aspirador primeiro.</p>
        <Link className="btn" href="/app/unidades">Ver unidades</Link>
      </>
    );
  }
  if (!machine) return <p className="sub">Carregando…</p>;

  const precoCents = machine.vacuumPriceCents ?? 0;
  const duracaoMin = machine.vacuumDurationMin ?? 0;

  return (
    <>
      <h1>Aspirador de pó</h1>
      <div className="card">
        <p className="sub">{duracaoMin} minutos por {money(precoCents)}.</p>
        {me && <p className="sub">Saldo: {money(me.walletCents)}</p>}
      </div>

      {!use && (
        <button className="btn" onClick={comprar} disabled={loading}>
          {loading ? "Processando…" : `Comprar por ${money(precoCents)}`}
        </button>
      )}

      {use?.status === "PAID" && (
        <>
          <p className="sub">Comprado! Aperte o botão quando estiver pronto pra usar.</p>
          <button className="btn" onClick={comecar} disabled={loading}>
            {loading ? "Processando…" : "Começar agora"}
          </button>
        </>
      )}

      {use?.status === "ACTIVE" && !finalizado && (
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, fontWeight: 800 }}>
            {restante != null
              ? `${String(Math.floor(restante / 60)).padStart(2, "0")}:${String(restante % 60).padStart(2, "0")}`
              : "--:--"}
          </div>
          <p className="sub">Aspirador liberado. Use até acabar o tempo.</p>
        </div>
      )}

      {(finalizado || use?.status === "COMPLETED") && (
        <div className="card" style={{ textAlign: "center" }}>
          <p>Tempo esgotado ✓</p>
          <p className="sub">Obrigado por usar o aspirador. Voltando pra tela inicial…</p>
        </div>
      )}

      {error && <p className="err">{error}</p>}
    </>
  );
}

export default function Aspirador() {
  return (
    <Suspense fallback={<p className="sub">Carregando…</p>}>
      <AspiradorConteudo />
    </Suspense>
  );
}
