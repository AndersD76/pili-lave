"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, setToken, type Me } from "../client";
import { Nav } from "../nav";

export default function Perfil() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Me>("/api/me").then((m) => { setMe(m); setName(m.name ?? ""); })
      .catch(() => router.replace("/app/login"));
  }, [router]);

  async function save() {
    setError(""); setSaved(false);
    try {
      await api("/api/me", { method: "PATCH", body: { name: name.trim() } });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar");
    }
  }

  const isLavador = me?.role === "LAVADOR" || me?.role === "ADMIN";

  return (
    <>
      <h1>Perfil</h1>
      <div className="card">
        <div className="lab">Telefone</div>
        <b style={{ fontSize: 17 }}>{me?.phone ?? "…"}</b>
      </div>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="lab">Seu nome</div>
        <input className="field" placeholder="Como podemos te chamar?" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn ghost" onClick={save}>{saved ? "Salvo!" : "Salvar"}</button>
        {error && <p className="err">{error}</p>}
      </div>
      {isLavador && (
        <Link className="btn" href="/app/scanner">Modo lavador — escanear voucher</Link>
      )}
      <button className="btn ghost" onClick={() => { setToken(null); router.replace("/app/login"); }}>Sair</button>
      <p className="sub center">PILI LAVE v1.0</p>
      <Nav />
    </>
  );
}
