"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, money, type Me, type Order, type Program } from "../client";

/** Compra manual (fallback sem câmera): gera voucher QR p/ o lavador. */
export default function NovaLavagem() {
  const router = useRouter();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Program[]>("/api/programs", { auth: false }).then(setPrograms).catch(() => {});
    api<Me>("/api/me").then(setMe).catch(() => router.replace("/app/login"));
  }, [router]);

  const selected = programs.find((p) => p.id === sel);
  const falta = selected && me ? selected.precoCents - me.walletCents : 0;

  async function comprar() {
    if (!selected) return;
    setError(""); setLoading(true);
    try {
      const order = await api<Order>("/api/orders", { body: { programId: selected.id } });
      router.replace(`/app/voucher/${order.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir");
      setLoading(false);
    }
  }

  return (
    <>
      <h1>Nova lavagem</h1>
      <p className="sub">Pague com saldo e mostre o QR ao lavador. Saldo: {me ? money(me.walletCents) : "…"}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {programs.map((p) => (
          <button key={p.id} type="button" className={`opt${sel === p.id ? " sel" : ""}`} onClick={() => setSel(p.id)}>
            <span className="nome">{p.id} · {p.nome}</span>
            <span className="preco">{money(p.precoCents)}</span>
          </button>
        ))}
      </div>
      {error && <p className="err">{error}</p>}
      {selected && falta > 0 ? (
        <>
          <p className="err">Saldo insuficiente — faltam {money(falta)}.</p>
          <Link className="btn" href="/app/recarga">Adicionar saldo</Link>
        </>
      ) : (
        <button className="btn" onClick={comprar} disabled={!selected || loading}>
          {loading ? "Processando…" : selected ? `Pagar ${money(selected.precoCents)} com saldo` : "Escolha o tipo"}
        </button>
      )}
    </>
  );
}
