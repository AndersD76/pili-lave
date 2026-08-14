"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, fmtPlate, money, type Program } from "../../client";

type Arrival = {
  id: string; plate: string; status: string;
  vehicle: { plate: string; defaultProgramId: number | null } | null;
};

export default function Chegada() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [state, setState] = useState<"choose" | "sending" | "green">("choose");
  const [error, setError] = useState("");

  useEffect(() => {
    api<Arrival>(`/api/arrivals/${id}`).then((a) => {
      setArrival(a);
      if (a.status === "REQUESTED" || a.status === "STARTED") setState("green");
      if (a.vehicle?.defaultProgramId) setSel(a.vehicle.defaultProgramId);
    }).catch(() => router.replace("/app"));
    api<Program[]>("/api/programs", { auth: false }).then(setPrograms).catch(() => {});
  }, [id, router]);

  async function liberar() {
    if (!sel) return;
    setError(""); setState("sending");
    try {
      await api(`/api/arrivals/${id}/request`, { body: { programId: sel } });
      setState("green");
    } catch (e) {
      setState("choose");
      setError(e instanceof Error ? e.message : "Não foi possível liberar");
    }
  }

  if (!arrival) return <p className="sub">Carregando…</p>;

  if (state === "green")
    return (
      <div className="center" style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 30 }}>
        <div className="successbig">OK</div>
        <h1>Lavagem liberada!</h1>
        <p className="sub">A luz verde acende em instantes — pode se aproximar.</p>
        <Link className="btn" href="/app">Voltar ao início</Link>
      </div>
    );

  const selected = programs.find((p) => p.id === sel);
  return (
    <>
      <h1>{fmtPlate(arrival.plate)} chegou!</h1>
      <p className="sub">Escolha a lavagem para liberar a máquina.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {programs.map((p) => (
          <button key={p.id} type="button" className={`opt${sel === p.id ? " sel" : ""}`} onClick={() => setSel(p.id)}>
            <span className="nome">{p.id} · {p.nome}</span>
            <span className="preco">{money(p.precoCents)}</span>
          </button>
        ))}
      </div>
      {error && <p className="err">{error}</p>}
      {error.includes("Saldo") && <Link className="btn ghost" href="/app/recarga">Adicionar saldo</Link>}
      <button className="btn" onClick={liberar} disabled={!sel || state === "sending"}>
        {state === "sending" ? "Liberando…" : selected ? `Liberar por ${money(selected.precoCents)}` : "Escolha o tipo"}
      </button>
    </>
  );
}
