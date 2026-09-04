"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtPlate, money, type Program } from "../../client";
import EtapaModal, { type Etapa } from "../../EtapaModal";
import CameraAoVivo from "../../CameraAoVivo";

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
  // avisos em modal: cada etapa aparece UMA vez, na ordem em que acontece
  const [etapa, setEtapa] = useState<Etapa | null>(null);
  const [detalhe, setDetalhe] = useState<string | undefined>();
  const vistas = useRef<Set<Etapa>>(new Set());

  const avisar = useCallback((e: Etapa, txt?: string) => {
    if (vistas.current.has(e)) return;
    vistas.current.add(e);
    setDetalhe(txt);
    setEtapa(e);
  }, []);

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

          // avisa o cliente a cada mudança de etapa da lavagem
          const st = a.lavagem?.status;
          if (st === "ACTIVE") avisar("reconhecido", "Pode entrar. Boa lavagem!");
          if (st === "ENTERED") avisar("iniciada", `${a.lavagem?.programa} em andamento.`);
          if (st === "FAILED") avisar("falha", `${money(a.lavagem!.valorCents)} devolvidos ao seu saldo.`);
          if (st === "COMPLETED") {
            avisar("finalizada", "Pode sair. Tenha um bom dia!");
            setTimeout(() => avisar("obrigado"), 4200);
          }

          // enquanto não terminou (concluída ou falhou), pergunta de novo em 5s
          if (st !== "COMPLETED" && st !== "FAILED") timer = setTimeout(() => carregar(false), 5000);
        })
        .catch(() => { if (primeira) router.replace("/app"); });

    carregar(true);
    api<Program[]>("/api/programs", { auth: false }).then(setPrograms).catch(() => {});
    return () => { vivo = false; clearTimeout(timer); };
  }, [id, router, avisar]);

  async function liberar() {
    if (!sel) return;
    setError(""); setState("sending");
    try {
      const prog = programs.find((p) => p.id === sel);
      await api(`/api/arrivals/${id}/request`, { body: { programId: sel } });
      setState("green");
      avisar("reserva", `${prog?.nome ?? "Lavagem"} reservada para ${fmtPlate(arrival!.plate)}.`);
      // pagamento é debitado junto com a reserva: avisa logo em seguida
      setTimeout(() => avisar("pagamento", prog ? `${money(prog.precoCents)} debitados do seu saldo.` : undefined), 4200);
    } catch (e) {
      setState("choose");
      setError(e instanceof Error ? e.message : "Não foi possível liberar");
    }
  }

  const Modal = etapa ? (
    <EtapaModal etapa={etapa} detalhe={detalhe} onFechar={() => setEtapa(null)} />
  ) : null;

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
        {Modal}
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
        <CameraAoVivo />
        {Modal}
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
      {Modal}
    </>
  );
}
