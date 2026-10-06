"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, getToken, type Station } from "../../client";

type AoVivoFrame = { id: string; at: string; plate: string | null; clientName: string | null } | null;
import { Nav } from "../../nav";

const SITUACAO: Record<Station["situacao"], { label: string; cor: string }> = {
  ABERTO: { label: "Aberto", cor: "var(--ok)" },
  OCUPADO: { label: "Ocupado", cor: "var(--atencao)" },
  MANUTENCAO: { label: "Manutenção", cor: "var(--erro)" },
  INATIVO: { label: "Inativa", cor: "var(--aco)" },
};

const STATUS_LABEL: Record<string, string> = {
  FREE: "Livre", WASHING: "Lavando", FAULT: "Falha", OFFLINE: "Offline", MAINTENANCE: "Manutenção",
};

/** Detalhe de uma unidade: máquinas, câmera (placeholder) e as duas ações —
 *  reservar lavagem, ou só aspiração de pó (quando a unidade tem máquina
 *  habilitada). A lista de unidades fica limpa, sem mencionar aspirador —
 *  essa opção só aparece depois de entrar na unidade especifica. */
function UnidadeConteudo() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const stationName = params.get("stationName");
  const programa = params.get("programa");
  const [station, setStation] = useState<Station | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [semLavagem, setSemLavagem] = useState(false);

  // Poll periódico — sem isso o status só atualizava ao reabrir a página, e
  // a cadeia display->câmera->backend já leva uns 15s sozinha pra propagar
  // uma mudança real (ex: sensor que destravou), então sem poll a tela
  // parecia muito mais lenta do que realmente é.
  useEffect(() => {
    const load = () => {
      api<{ stations: Station[] }>("/api/stations", { auth: false })
        .then(({ stations }) => setStation(stations.find((s) => s.id === id) ?? null))
        .catch(() => {})
        .finally(() => setLoaded(true));
    };
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [id]);

  // Câmera ao vivo: só existe enquanto o cliente tem lavagem em andamento
  // (o backend barra com 403 fora disso). Poll leve nos metadados; só baixa
  // o JPEG de novo quando o id da captura muda.
  useEffect(() => {
    let frameIdAtual: string | null = null;
    let cancelado = false;
    const tick = async () => {
      try {
        const r = await api<{ frame: AoVivoFrame }>("/api/lpr/ao-vivo");
        if (cancelado) return;
        setSemLavagem(false);
        if (!r.frame) return;
        if (r.frame.id === frameIdAtual) return;
        frameIdAtual = r.frame.id;
        const token = getToken();
        const res = await fetch(`/api/lpr/ao-vivo?img=${encodeURIComponent(r.frame.id)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok || cancelado) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setFrameUrl((old) => { if (old) URL.revokeObjectURL(old); return url; });
      } catch {
        if (!cancelado) setSemLavagem(true);
      }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => { cancelado = true; clearInterval(t); };
  }, []);

  if (!station) {
    return <p className="sub">{loaded ? "Unidade não encontrada." : "Carregando…"}</p>;
  }

  const sit = SITUACAO[station.situacao] ?? SITUACAO.INATIVO;
  const vacuumMachine = station.machines.find((m) => m.vacuumEnabled);
  const lavagemQs = new URLSearchParams({ stationId: station.id, stationName: station.name });
  if (programa) lavagemQs.set("programa", programa);

  return (
    <>
      <h1>{stationName ?? station.name}</h1>
      <p className="sub">{station.address} · {station.city}/{station.state}</p>
      <p style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: sit.cor, display: "inline-block" }} />
        <span className="sub">{sit.label}</span>
      </p>

      <h2 style={{ marginTop: 18, fontSize: 14 }}>Máquinas</h2>
      {station.machines.length === 0 ? (
        <p className="sub">Sem máquinas cadastradas.</p>
      ) : (
        <div className="card">
          {station.machines.map((m) => (
            <div key={m.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
              <span>{m.name}</span>
              <span className="sub">{STATUS_LABEL[m.status] ?? m.status}</span>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: 18, fontSize: 14 }}>Câmera ao vivo</h2>
      <div className="card">
        {frameUrl ? (
          <img src={frameUrl} alt="Câmera ao vivo" style={{ width: "100%", borderRadius: 8, display: "block" }} />
        ) : (
          <p className="sub">
            {semLavagem
              ? "Disponível quando sua lavagem estiver em andamento."
              : "Aguardando imagem da câmera…"}
          </p>
        )}
      </div>

      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        <Link href={`/app/lavagem?${lavagemQs.toString()}`} className="btn" style={{ display: "block", textAlign: "center" }}>
          Reservar lavagem
        </Link>
        {vacuumMachine && (
          <Link
            href={`/app/aspirador?machineId=${encodeURIComponent(vacuumMachine.id)}`}
            className="btn"
            style={{ display: "block", textAlign: "center" }}
          >
            {vacuumMachine.vacuumDurationMin} min de aspirador de pó
          </Link>
        )}
      </div>
      <Nav />
    </>
  );
}

export default function UnidadeDetalhe() {
  return (
    <Suspense fallback={<p className="sub">Carregando…</p>}>
      <UnidadeConteudo />
    </Suspense>
  );
}
