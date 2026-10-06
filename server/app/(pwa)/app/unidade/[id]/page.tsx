"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, type Station } from "../../client";
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

  useEffect(() => {
    api<{ stations: Station[] }>("/api/stations", { auth: false })
      .then(({ stations }) => setStation(stations.find((s) => s.id === id) ?? null))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [id]);

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
        <p className="sub">Câmera em manutenção — disponível em breve.</p>
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
