"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, type Station } from "../client";
import { Nav } from "../nav";

const SITUACAO: Record<Station["situacao"], { label: string; cor: string }> = {
  ABERTO: { label: "Aberto", cor: "var(--ok)" },
  OCUPADO: { label: "Ocupado", cor: "var(--atencao)" },
  MANUTENCAO: { label: "Manutenção", cor: "var(--erro)" },
  INATIVO: { label: "Inativa", cor: "var(--aco)" },
};

/** Lista de unidades — sempre passa por aqui antes de escolher a lavagem,
 * mesmo quando só existe uma: é a unidade que define o preço e pra qual
 * máquina a reserva vai. */
function UnidadesConteudo() {
  const params = useSearchParams();
  const programa = params.get("programa");
  const [stations, setStations] = useState<Station[] | null>(null);

  useEffect(() => {
    api<{ stations: Station[] }>("/api/stations", { auth: false })
      .then((r) => setStations(r.stations))
      .catch(() => setStations([]));
  }, []);

  function hrefPara(s: Station): string {
    const qs = new URLSearchParams({ stationId: s.id, stationName: s.name });
    if (programa) qs.set("programa", programa);
    return `/app/lavagem?${qs.toString()}`;
  }

  return (
    <>
      <h1>Escolha a unidade</h1>
      <p className="sub">O preço e a máquina dependem da unidade escolhida.</p>
      {stations === null ? (
        <p className="sub">Carregando…</p>
      ) : stations.length === 0 ? (
        <p className="sub">Nenhuma unidade disponível no momento.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {stations.map((s) => {
            const sit = SITUACAO[s.situacao] ?? SITUACAO.INATIVO;
            return (
              <Link key={s.id} href={hrefPara(s)} className="opt" style={{ display: "block" }}>
                <span className="nome">{s.name}</span>
                <span className="sub" style={{ display: "block" }}>{s.address} · {s.city}/{s.state}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: sit.cor, display: "inline-block" }} />
                  <span className="sub">{sit.label}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
      <Nav />
    </>
  );
}

export default function Unidades() {
  return (
    <Suspense fallback={<p className="sub">Carregando…</p>}>
      <UnidadesConteudo />
    </Suspense>
  );
}
