"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api, fmtPlate, money, type Order } from "../../client";

export default function Voucher() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [qrUrl, setQrUrl] = useState("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const load = () => api<Order>(`/api/orders/${id}`).then(async (o) => {
      setOrder(o);
      if (o.status === "PAID" && !qrUrl)
        setQrUrl(await QRCode.toDataURL(`PILILAVE:${o.voucherCode}`, { width: 480, margin: 1 }));
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
      <p className="sub center">Mostre este código ao lavador</p>
      <p className="sub center" style={{ fontSize: 12 }}>{order.voucherCode}</p>
    </>
  );
}
