"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, fmtPlate, money, setToken, type Me, type Vehicle } from "../client";
import { Nav } from "../nav";
import { AvisosPush } from "../AvisosPush";

export default function Perfil() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // troca de senha
  const [abrirSenha, setAbrirSenha] = useState(false);
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [msgSenha, setMsgSenha] = useState("");

  const carregar = () => {
    api<Me>("/api/me").then((m) => { setMe(m); setName(m.name ?? ""); })
      .catch(() => router.replace("/app/login"));
    api<Vehicle[]>("/api/vehicles").then(setVehicles).catch(() => {});
  };
  useEffect(carregar, [router]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setError(""); setSaved(false);
    try {
      await api("/api/me", { method: "PATCH", body: { name: name.trim() } });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar");
    }
  }

  async function trocarSenha() {
    setMsgSenha("");
    try {
      await api("/api/auth/senha", { body: { atual, nova } });
      setMsgSenha("Senha alterada!");
      setAtual(""); setNova("");
      setTimeout(() => { setAbrirSenha(false); setMsgSenha(""); }, 1500);
    } catch (e) {
      setMsgSenha(e instanceof Error ? e.message : "Não foi possível trocar");
    }
  }

  async function removerVeiculo(v: Vehicle) {
    if (!confirm(`Remover ${fmtPlate(v.plate)}? A câmera deixa de reconhecer esta placa.`)) return;
    try {
      await api(`/api/vehicles/${v.id}`, { method: "DELETE" });
      carregar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível remover");
    }
  }

  const isLavador = me?.role === "LAVADOR" || me?.role === "ADMIN";

  const LABEL_TIPO: Record<string, string> = {
    LAVADOR: "Lavador", COMISSAO1: "Vendedor 1", COMISSAO2: "Vendedor 2", ALUGUEL: "Aluguel",
  };

  return (
    <>
      <h1>Perfil</h1>

      {me?.cadastroPendente && (
        <div className="card">
          <div className="lab">Cadastro em análise</div>
          <p className="sub">
            Seu pedido pra virar {LABEL_TIPO[me.cadastroTipoSolicitado ?? ""] ?? "parceiro"} ainda não foi aprovado
            pelo admin. Você continua usando o app normalmente como cliente enquanto isso.
          </p>
        </div>
      )}

      <div className="card">
        <div className="lab">Saldo</div>
        <div className="money"><span className="cur">R$</span>{((me?.walletCents ?? 0) / 100).toFixed(2).replace(".", ",")}</div>
        <div style={{ marginTop: 12 }}>
          <Link className="btn ghost" href="/app/recarga">Adicionar saldo</Link>
        </div>
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="lab">Seus dados</div>
        <input className="field" placeholder="Como podemos te chamar?" value={name} onChange={(e) => setName(e.target.value)} />
        {me?.email && <p className="sub">E-mail: {me.email}</p>}
        {me?.phone && <p className="sub">Telefone: {me.phone}</p>}
        <button className="btn ghost" onClick={save}>{saved ? "Salvo!" : "Salvar"}</button>
        {error && <p className="err">{error}</p>}
      </div>

      {/* Veículos: dava para adicionar mas não para remover — placa errada
          ficava presa para sempre, e a câmera continuava reconhecendo. */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="lab">Meus veículos</div>
        {vehicles.length === 0 && <p className="sub">Nenhum veículo cadastrado.</p>}
        {vehicles.map((v) => (
          <div className="item" key={v.id}>
            <span className="placa">{fmtPlate(v.plate)}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="meta">{[v.brand, v.model].filter(Boolean).join(" ") || "Veículo"}</span>
              <button className="btn-mini" onClick={() => removerVeiculo(v)}>Remover</button>
            </span>
          </div>
        ))}
        <Link className="btn ghost" href="/app/veiculo">+ Adicionar veículo</Link>
      </div>

      <AvisosPush />

      {me?.email && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="lab">Segurança</div>
          {!abrirSenha ? (
            <button className="btn ghost" onClick={() => setAbrirSenha(true)}>Trocar senha</button>
          ) : (
            <>
              <input className="field" type="password" placeholder="Senha atual" value={atual} onChange={(e) => setAtual(e.target.value)} />
              <input className="field" type="password" placeholder="Nova senha (8+, com letra e número)" value={nova} onChange={(e) => setNova(e.target.value)} />
              <button className="btn" onClick={trocarSenha} disabled={!atual || !nova}>Confirmar</button>
              <button className="btn ghost" onClick={() => { setAbrirSenha(false); setMsgSenha(""); }}>Cancelar</button>
              {msgSenha && <p className={msgSenha.includes("alterada") ? "sub" : "err"}>{msgSenha}</p>}
            </>
          )}
        </div>
      )}

      {isLavador && <Link className="btn" href="/app/scanner">Modo lavador — escanear voucher</Link>}
      {me?.role === "ADMIN" && <Link className="btn ghost" href="/admin">Painel do admin</Link>}
      <button className="btn ghost" onClick={() => { setToken(null); router.replace("/app/login"); }}>Sair</button>
      <p className="sub center">PILI CLEAN v1.0</p>
      <Nav />
    </>
  );
}
