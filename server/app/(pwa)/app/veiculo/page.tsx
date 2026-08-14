"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../client";

const PLATE_RE = /^[A-Z]{3}\d{4}$|^[A-Z]{3}\d[A-Z]\d{2}$/;

export default function VeiculoNovo() {
  const router = useRouter();
  const [plate, setPlate] = useState("");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const normalized = plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const valid = PLATE_RE.test(normalized);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await api("/api/vehicles", { body: { plate: normalized, model: model.trim() || undefined } });
      router.replace("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível cadastrar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1>Novo veículo</h1>
      <div>
        <div className="lab">Placa</div>
        <input
          className="field big" style={{ letterSpacing: 6 }} placeholder="ABC1D23"
          value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} maxLength={8} autoFocus
        />
        <p className="sub" style={{ marginTop: 6 }}>Formato antigo (ABC1234) ou Mercosul (ABC1D23).</p>
      </div>
      <div>
        <div className="lab">Modelo (opcional)</div>
        <input className="field" placeholder="Ex.: Fiat Toro" value={model} onChange={(e) => setModel(e.target.value)} maxLength={60} />
      </div>
      {error && <p className="err">{error}</p>}
      <button className="btn" disabled={!valid || loading}>{loading ? "Cadastrando…" : "Cadastrar veículo"}</button>
    </form>
  );
}
