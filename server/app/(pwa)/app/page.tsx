"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, fmtPlate, getToken, money, type Me, type Order, type Program, type Vehicle } from "./client";
import { Nav } from "./nav";
import { StatusMaquina } from "./StatusMaquina";
import { ProgressoLavagem, type StatusLavagem } from "./ProgressoLavagem";
import CameraAoVivo from "./CameraAoVivo";
import { Logo } from "./Logo";

type Arrival = {
  id: string; plate: string; status: "WAITING_DRIVER" | "NO_MATCH" | "REQUESTED" | "STARTED" | "EXPIRED";
  vehicle: { plate: string; defaultProgramId: number | null } | null;
  /** status da reserva: é ele que diz o que aconteceu na máquina */
  lavagem?: StatusLavagem;
  reservaId?: string | null;
};

export default function Home() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [ultima, setUltima] = useState<Order | null>(null);
  const [programas, setProgramas] = useState<Program[]>([]);
  const [liberando, setLiberando] = useState(false);
  const [erroLiberar, setErroLiberar] = useState("");
  const [cancelando, setCancelando] = useState(false);

  /* Cancelar só vale ANTES de o carro entrar; o servidor recusa depois do
     X14. Devolve o valor pago ao saldo. */
  async function cancelar() {
    if (!arrival?.reservaId) return;
    if (!confirm("Cancelar a lavagem? O valor volta para o seu saldo.")) return;
    setErroLiberar(""); setCancelando(true);
    try {
      await api(`/api/reservations/${arrival.reservaId}/cancel`, { body: {} });
      const r = await api<{ arrival: Arrival | null }>("/api/arrivals/mine");
      setArrival(r.arrival);
      load();   // saldo atualizado
    } catch (e) {
      setErroLiberar(e instanceof Error ? e.message : "Não foi possível cancelar");
    } finally {
      setCancelando(false);
    }
  }

  /* Libera a lavagem JÁ PAGA sem depender da câmera. Não cobra de novo:
     o servidor reaproveita a reserva que existe. */
  async function liberarAgora() {
    setErroLiberar(""); setLiberando(true);
    try {
      await api("/api/orders", { body: { programId: 1, jaEstouNaMaquina: true } });
      const r = await api<{ arrival: Arrival | null }>("/api/arrivals/mine");
      setArrival(r.arrival);
    } catch (e) {
      setErroLiberar(e instanceof Error ? e.message : "Não foi possível liberar");
    } finally {
      setLiberando(false);
    }
  }

  const load = useCallback(() => {
    api<Me>("/api/me").then(setMe).catch(() => router.replace("/app/login"));
    api<Vehicle[]>("/api/vehicles").then(setVehicles).catch(() => {});
    // última lavagem: atalho para repetir sem escolher tudo de novo
    api<Order[]>("/api/orders").then((os) => setUltima(os[0] ?? null)).catch(() => {});
    api<Program[]>("/api/programs", { auth: false }).then(setProgramas).catch(() => {});
  }, [router]);

  useEffect(() => {
    if (!getToken()) { router.replace("/app/cadastro"); return; }
    load();
    const poll = setInterval(() => {
      api<{ arrival: Arrival | null }>("/api/arrivals/mine")
        .then((r) => setArrival(r.arrival))
        .catch(() => {});
    }, 4000);
    return () => clearInterval(poll);
  }, [router, load]);

  const maisBarata = programas.length
    ? programas.reduce((a, b) => (a.precoCents <= b.precoCents ? a : b))
    : null;
  const saldoCurto = !!me && !!maisBarata && me.walletCents < maisBarata.precoCents;

  return (
    <>
      <Logo />

      {/* Primeira coisa que o cliente vê: dá para lavar agora? */}
      <StatusMaquina />

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
      {/* Onde a lavagem está, em etapas — e a câmera junto, para o cliente
          ver o próprio carro sem sair do app. */}
      {arrival?.lavagem && <ProgressoLavagem status={arrival.lavagem} />}

      {/* Lavagem paga esperando a câmera: o botão de liberar sem ela fica
          AQUI, em destaque. Antes só existia dentro da tela de compra —
          quem já tinha pago não passava mais por lá e não achava. */}
      {arrival?.lavagem === "HELD" && (
        <div className="card" style={{ borderColor: "var(--jato)", borderWidth: 2 }}>
          <div className="lab" style={{ color: "var(--jato)" }}>Lavagem paga — aguardando você chegar</div>
          <p className="sub">
            A câmera libera sozinha ao reconhecer sua placa. Se já está na frente
            da máquina e nada aconteceu, libere por aqui.
          </p>
          <button className="btn" onClick={liberarAgora} disabled={liberando} style={{ marginTop: 10 }}>
            {liberando ? "Liberando…" : "Já estou na máquina — liberar agora"}
          </button>
          {erroLiberar && <p className="err">{erroLiberar}</p>}
          {/* Desistiu: cancelar e receber o dinheiro de volta. Só aparece
              ANTES de o carro entrar — depois disso o ciclo já começou. */}
          <button className="btn ghost" onClick={cancelar} disabled={cancelando} style={{ marginTop: 8 }}>
            {cancelando ? "Cancelando…" : "Cancelar lavagem e receber de volta"}
          </button>
          {/* O QR ainda serve para validar no balcão (fluxo do lavador) —
              fica a um toque, sem ocupar a tela. */}
          {ultima?.status === "PAID" && (
            <Link className="btn ghost" href={`/app/voucher/${ultima.id}`} style={{ marginTop: 8 }}>
              Ver comprovante / QR
            </Link>
          )}
        </div>
      )}
      {arrival?.lavagem && arrival.lavagem !== "COMPLETED" && arrival.lavagem !== "FAILED" && (
        <CameraAoVivo />
      )}

      <div className="card" style={saldoCurto ? { borderColor: "var(--atencao)" } : undefined}>
        <div className="lab">Saldo disponível</div>
        <div className="money"><span className="cur">R$</span>{((me?.walletCents ?? 0) / 100).toFixed(2).replace(".", ",")}</div>
        {/* avisa ANTES de o cliente chegar na máquina e não conseguir pagar */}
        {saldoCurto && (
          <p className="sub" style={{ color: "var(--atencao)", marginTop: 6 }}>
            Não dá para pagar nem a lavagem mais barata ({money(maisBarata!.precoCents)}). Adicione saldo antes de vir.
          </p>
        )}
        <div style={{ marginTop: 12 }}>
          <Link className="btn ghost" href="/app/recarga">Adicionar saldo</Link>
        </div>
      </div>

      <Link className="btn" href="/app/unidades">Nova lavagem</Link>
      {/* repetir a última: o cliente costuma pedir sempre a mesma — mas a
          unidade continua sendo escolhida antes, o preço pode ter mudado */}
      {ultima && !arrival?.lavagem && (
        <Link className="btn ghost" href={`/app/unidades?programa=${ultima.program.id}`}>
          Repetir {ultima.program.nome} · {money(ultima.amountCents)}
        </Link>
      )}

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
