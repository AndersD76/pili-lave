"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api, fmtPlate, money, type Order } from "../../client";
import EtapaModal, { type Etapa } from "../../EtapaModal";

type Lavagem = { status: string; valorCents: number; concluidaEm: string | null } | null;

export default function Voucher() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<(Order & { lavagem: Lavagem }) | null>(null);
  // avisos das etapas: aparecem aqui, que é onde o cliente fica depois de pagar
  const [etapa, setEtapa] = useState<Etapa | null>(null);
  const [detalhe, setDetalhe] = useState<string | undefined>();
  const vistas = useRef<Set<Etapa>>(new Set());
  const avisar = (e: Etapa, txt?: string) => {
    if (vistas.current.has(e)) return;
    vistas.current.add(e);
    setDetalhe(txt);
    setEtapa(e);
  };
  const [qrUrl, setQrUrl] = useState("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const load = () => api<Order & { lavagem: Lavagem }>(`/api/orders/${id}`).then(async (o) => {
      setOrder(o);
      if (o.status === "PAID" && !qrUrl)
        setQrUrl(await QRCode.toDataURL(`PILILAVE:${o.voucherCode}`, { width: 480, margin: 1 }));

      // avisa o cliente a cada mudança de etapa da lavagem
      const st = o.lavagem?.status;
      const val = money(o.lavagem?.valorCents ?? o.amountCents);
      if (st === "HELD") { avisar("reserva", `${o.program.nome} reservada.`); avisar("pagamento", `${val} debitados do seu saldo.`); }
      if (st === "ACTIVE") avisar("reconhecido", "Pode entrar. Boa lavagem!");
      if (st === "ENTERED") avisar("iniciada", `${o.program.nome} em andamento.`);
      if (st === "FAILED") avisar("falha", `${val} devolvidos ao seu saldo.`);
      if (st === "COMPLETED") {
        avisar("finalizada", "Pode sair. Tenha um bom dia!");
        setTimeout(() => avisar("obrigado"), 4200);
      }
      if (st === "COMPLETED" || st === "FAILED") { if (poll.current) clearInterval(poll.current); }
    }).catch(() => {});
    load();
    poll.current = setInterval(load, 4000);
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order) return <p className="sub">Carregando…</p>;

  if (order.status === "REDEEMED")
    return (
      <div className="center" style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 30 }}>
        <div className="successbig">OK</div>
        <h1>Lavagem liberada!</h1>
        <p className="sub">{order.program.nome} · {money(order.amountCents)}</p>
        <Link className="btn" href="/app">Voltar ao início</Link>
        {etapa && <EtapaModal etapa={etapa} detalhe={detalhe} onFechar={() => setEtapa(null)} />}
      </div>
    );

  return (
    <>
      <h1>Voucher</h1>
      <div className="qrcard voucher">
        {qrUrl && <img src={qrUrl} alt="QR do voucher" />}
        <div className="tipo">Lavagem {order.program.id} · {order.program.nome}</div>
      </div>
      {order.vehicle && <p className="sub center placa">{fmtPlate(order.vehicle.plate)}</p>}
      {/* Com reserva o fluxo é pela câmera: o QR só vale como alternativa
          manual (lavador no balcão). Sem reserva, o QR é o caminho. */}
      <p className="sub center">
        {order.lavagem
          ? "Aproxime o carro da câmera — a máquina libera sozinha ao reconhecer sua placa."
          : "Mostre este código ao lavador"}
      </p>
      <p className="sub center" style={{ fontSize: 12 }}>{order.voucherCode}</p>
      {etapa && <EtapaModal etapa={etapa} detalhe={detalhe} onFechar={() => setEtapa(null)} />}
    </>
  );
}
