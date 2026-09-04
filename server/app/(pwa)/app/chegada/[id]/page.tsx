"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, fmtPlate, money, type Program } from "../../client";

type Lavagem = {
  status: string;            // HELD | ACTIVE | ENTERED | COMPLETED | ...
  programa: string;
  valorCents: number;
  concluidaEm: string | null;
} | null;

type Arrival = {
  id: string; plate: string; status: string;
  vehicle: { plate: string; defaultProgramId: number | null } | null;
  lavagem: Lavagem;
};

export default function Chegada() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [state, setState] = useState<"choose" | "sending" | "green">("choose");
  const [error, setError] = useState("");

  // Acompanha a lavagem até o fim: a MÁQUINA avisa a nuvem quando o ciclo
  // encerra (wash-complete) e é aqui que o app mostra. Sem esta consulta
  // periódica a tela ficava congelada em "liberada" para sempre.
  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout>;

    const carregar = (primeira: boolean) =>
      api<Arrival>(`/api/arrivals/${id}`)
        .then((a) => {
          if (!vivo) return;
          setArrival(a);
          if (a.status === "REQUESTED" || a.status === "STARTED") setState("green");
          if (primeira && a.vehicle?.defaultProgramId) setSel(a.vehicle.defaultProgramId);
          // enquanto não concluiu, pergunta de novo em 5s
          if (a.lavagem?.status !== "COMPLETED") timer = setTimeout(() => carregar(false), 5000);
        })
        .catch(() => { if (primeira) router.replace("/app"); });

    carregar(true);
    api<Program[]>("/api/programs", { auth: false }).then(setPrograms).catch(() => {});
    return () => { vivo = false; clearTimeout(timer); };
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

  const lav = arrival.lavagem;

  // Ciclo encerrado: a máquina avisou a nuvem e o valor foi debitado.
  if (lav?.status === "COMPLETED")
    return (
      <div className="center" style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 30 }}>
        <div className="successbig">OK</div>
        <h1>Lavagem concluída!</h1>
        <p className="sub">
          {lav.programa} — {money(lav.valorCents)} debitados do seu saldo.
        </p>
        <Link className="btn" href="/app">Voltar ao início</Link>
        <Link className="btn ghost" href="/app/historico">Ver histórico</Link>
      </div>
    );

  if (state === "green") {
    const lavando = lav?.status === "ENTERED";
    return (
      <div className="center" style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 30 }}>
        <div className="successbig">OK</div>
        <h1>{lavando ? "Lavando…" : "Lavagem liberada!"}</h1>
        <p className="sub">
          {lavando
            ? "A máquina está lavando o seu carro. Avisamos aqui quando terminar."
            : "A luz verde acende em instantes — pode se aproximar."}
        </p>
        <Link className="btn" href="/app">Voltar ao início</Link>
      </div>
    );
  }

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
