"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, fmtPlate, money, type Order } from "../client";
import { Nav } from "../nav";

type Tx = { id: string; amountCents: number; kind: string; note: string | null; createdAt: string };
type Carteira = { walletCents: number; reservedCents: number; availableCents: number; txs: Tx[] };

const MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

/** "setembro de 2026" — agrupa a lista por mês em vez de uma fila crua. */
function chaveMes(iso: string): string {
  const d = new Date(iso);
  return `${MES[d.getMonth()]} de ${d.getFullYear()}`;
}

export default function Historico() {
  const router = useRouter();
  const [aba, setAba] = useState<"lavagens" | "saldo">("lavagens");
  const [orders, setOrders] = useState<Order[]>([]);
  const [carteira, setCarteira] = useState<Carteira | null>(null);

  useEffect(() => {
    api<Order[]>("/api/orders").then(setOrders).catch(() => router.replace("/app/login"));
    api<Carteira>("/api/wallet").then(setCarteira).catch(() => {});
  }, [router]);

  // só lavagens que valeram (canceladas entram no extrato, não aqui)
  const validas = orders.filter((o) => o.status !== "CANCELED");
  const gastoTotal = validas.reduce((s, o) => s + o.amountCents, 0);

  const porMes = new Map<string, Order[]>();
  for (const o of orders) {
    const k = chaveMes(o.createdAt);
    porMes.set(k, [...(porMes.get(k) ?? []), o]);
  }

  const txPorMes = new Map<string, Tx[]>();
  for (const t of carteira?.txs ?? []) {
    const k = chaveMes(t.createdAt);
    txPorMes.set(k, [...(txPorMes.get(k) ?? []), t]);
  }

  return (
    <>
      <h1>Histórico</h1>

      <div className="resumo">
        <div>
          <div className="lab">Lavagens</div>
          <div className="val">{validas.length}</div>
        </div>
        <div>
          <div className="lab">Total gasto</div>
          <div className="val">{money(gastoTotal)}</div>
        </div>
        <div>
          <div className="lab">Saldo</div>
          <div className="val">{money(carteira?.walletCents ?? 0)}</div>
        </div>
      </div>

      {/* reserva viva segura parte do saldo — explicar evita o susto de
          "tenho saldo mas não consigo usar" */}
      {!!carteira?.reservedCents && (
        <p className="sub">
          {money(carteira.reservedCents)} reservados para uma lavagem em andamento ·
          disponível: {money(carteira.availableCents)}
        </p>
      )}

      <div className="abas">
        <button className={aba === "lavagens" ? "on" : ""} onClick={() => setAba("lavagens")}>Lavagens</button>
        <button className={aba === "saldo" ? "on" : ""} onClick={() => setAba("saldo")}>Extrato do saldo</button>
      </div>

      {aba === "lavagens" && (
        <>
          {orders.length === 0 && <p className="sub">Nenhuma lavagem ainda.</p>}
          {[...porMes.entries()].map(([mes, lista]) => (
            <div key={mes}>
              <div className="lab" style={{ marginTop: 14 }}>{mes}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {lista.map((o) => (
                  <Link key={o.id} className="item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
                    href={o.status === "PAID" ? `/app/voucher/${o.id}` : "#"}>
                    <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <b style={{ fontFamily: "var(--font-display)", fontSize: 16 }}>{o.program.nome}</b>
                      {o.status === "PAID" && <span className="chip at">Aguardando</span>}
                      {o.status === "REDEEMED" && <span className="chip ok">Concluída</span>}
                      {o.status === "CANCELED" && <span className="chip off">Cancelada · estornada</span>}
                    </span>
                    <span className="meta">
                      {money(o.amountCents)}
                      {o.vehicle ? ` · ${fmtPlate(o.vehicle.plate)}` : ""} ·{" "}
                      {new Date(o.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      {o.status === "PAID" ? " · toque para ver o comprovante / QR" : ""}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {aba === "saldo" && (
        <>
          {!carteira?.txs.length && <p className="sub">Nenhuma movimentação ainda.</p>}
          {[...txPorMes.entries()].map(([mes, lista]) => (
            <div key={mes}>
              <div className="lab" style={{ marginTop: 14 }}>{mes}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {lista.map((t) => (
                  <div className="item" key={t.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <b style={{ fontSize: 15 }}>
                        {t.kind === "TOPUP" ? "Recarga" : t.kind === "WASH" ? "Lavagem" : "Ajuste"}
                      </b>
                      <b style={{ color: t.amountCents >= 0 ? "var(--ok)" : "var(--cromo)", fontFamily: "var(--font-display)" }}>
                        {t.amountCents >= 0 ? "+" : "−"}{money(Math.abs(t.amountCents))}
                      </b>
                    </span>
                    <span className="meta">
                      {new Date(t.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      {t.note ? ` · ${t.note}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
      <Nav />
    </>
  );
}
