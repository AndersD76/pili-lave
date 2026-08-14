"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, fmtPlate, money, type Order } from "../client";
import { Nav } from "../nav";

export default function Historico() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    api<Order[]>("/api/orders").then(setOrders).catch(() => router.replace("/app/login"));
  }, [router]);

  return (
    <>
      <h1>Minhas lavagens</h1>
      {orders.length === 0 && <p className="sub">Nenhuma lavagem ainda.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {orders.map((o) => (
          <Link key={o.id} className="item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
            href={o.status === "PAID" ? `/app/voucher/${o.id}` : "#"}>
            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b style={{ fontFamily: "var(--font-display)", fontSize: 16 }}>{o.program.nome}</b>
              {o.status === "PAID" && <span className="chip at">Aguardando</span>}
              {o.status === "REDEEMED" && <span className="chip ok">Liberada</span>}
              {o.status === "CANCELED" && <span className="chip off">Cancelada</span>}
            </span>
            <span className="meta">
              {money(o.amountCents)}
              {o.vehicle ? ` · ${fmtPlate(o.vehicle.plate)}` : ""} · {new Date(o.createdAt).toLocaleDateString("pt-BR")}
              {o.status === "PAID" ? " · toque p/ ver o QR" : ""}
            </span>
          </Link>
        ))}
      </div>
      <Nav />
    </>
  );
}
