"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, fmtPlate, getToken, money, type Me, type Vehicle } from "./client";
import { Nav } from "./nav";

type Arrival = {
  id: string; plate: string; status: "WAITING_DRIVER" | "NO_MATCH" | "REQUESTED" | "STARTED" | "EXPIRED";
  vehicle: { plate: string; defaultProgramId: number | null } | null;
  /** status da reserva: é ele que diz o que aconteceu na máquina */
  lavagem?: "HELD" | "ACTIVE" | "ENTERED" | "COMPLETED" | "FAILED" | "EXPIRED" | null;
};

export default function Home() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [arrival, setArrival] = useState<Arrival | null>(null);

  const load = useCallback(() => {
    api<Me>("/api/me").then(setMe).catch(() => router.replace("/app/login"));
    api<Vehicle[]>("/api/vehicles").then(setVehicles).catch(() => {});
  }, [router]);

  useEffect(() => {
    if (!getToken()) { router.replace("/app/login"); return; }
    load();
    const poll = setInterval(() => {
      api<{ arrival: Arrival | null }>("/api/arrivals/mine")
        .then((r) => setArrival(r.arrival))
        .catch(() => {});
    }, 4000);
    return () => clearInterval(poll);
  }, [router, load]);

  return (
    <>
      <div className="pw-logo">PILI LAVE<span>.</span></div>

      {arrival?.status === "WAITING_DRIVER" && (
        <Link href={`/app/chegada/${arrival.id}`} style={{ textDecoration: "none" }}>
          <div className="card" style={{ borderColor: "var(--jato)", borderWidth: 2 }}>
            <div className="lab" style={{ color: "var(--jato)" }}>Seu carro está na máquina</div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 24, color: "var(--cromo)" }}>
              {fmtPlate(arrival.plate)} chegou!
            </div>
            <p className="sub">Toque para escolher a lavagem e liberar.</p>
          </div>
        </Link>
      )}
      {arrival?.status === "REQUESTED" && arrival.lavagem !== "FAILED" && arrival.lavagem !== "COMPLETED" && (
        <div className="card" style={{ borderColor: "var(--atencao)" }}>
          <div className="lab" style={{ color: "var(--atencao)" }}>
            {arrival.lavagem === "ACTIVE" ? "Luz verde!" : "Aguardando a máquina…"}
          </div>
          <p className="sub">
            {arrival.lavagem === "ACTIVE"
              ? "Pode entrar. Boa lavagem!"
              : "Lavagem paga. A luz verde acende em instantes."}
          </p>
        </div>
      )}
      {arrival?.lavagem === "FAILED" && (
        <div className="card" style={{ borderColor: "var(--erro)" }}>
          <div className="lab" style={{ color: "var(--erro)" }}>Lavagem interrompida</div>
          <p className="sub">A máquina apresentou falha. O valor foi devolvido ao seu saldo.</p>
        </div>
      )}
      {arrival?.lavagem === "COMPLETED" && (
        <div className="card" style={{ borderColor: "var(--ok)" }}>
          <div className="lab" style={{ color: "var(--ok)" }}>Lavagem finalizada</div>
          <p className="sub">Pode sair. Tenha um bom dia!</p>
        </div>
      )}
      {arrival?.status === "STARTED" && (
        <div className="card" style={{ borderColor: "var(--ok)" }}>
          <div className="lab" style={{ color: "var(--ok)" }}>Luz verde!</div>
          <p className="sub">Lavagem liberada — pode entrar. Boa lavagem!</p>
        </div>
      )}

      <div className="card">
        <div className="lab">Saldo disponível</div>
        <div className="money"><span className="cur">R$</span>{((me?.walletCents ?? 0) / 100).toFixed(2).replace(".", ",")}</div>
        <div style={{ marginTop: 12 }}>
          <Link className="btn ghost" href="/app/recarga">Adicionar saldo</Link>
        </div>
      </div>

      <Link className="btn" href="/app/lavagem">Nova lavagem</Link>

      <div>
        <div className="lab">Meus veículos</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {vehicles.map((v) => (
            <div className="item" key={v.id}>
              <span className="placa">{fmtPlate(v.plate)}</span>
              <span className="meta">{[v.brand, v.model].filter(Boolean).join(" ") || "Veículo"}</span>
            </div>
          ))}
          <Link className="item" href="/app/veiculo" style={{ borderStyle: "dashed" }}>
            <span style={{ color: "var(--jato)", fontWeight: 600 }}>+ Adicionar veículo</span>
            <span className="meta">a câmera reconhece a placa</span>
          </Link>
        </div>
      </div>

      {me && money(me.walletCents) === "R$ 0,00" && vehicles.length === 0 && (
        <p className="sub">Cadastre seu veículo e adicione saldo — na próxima vinda a câmera te reconhece sozinha.</p>
      )}
      <Nav />
    </>
  );
}
