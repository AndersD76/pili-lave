"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, getToken, type LojaDoDono } from "../client";

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

type Mensagem = LojaDoDono["mensagens"][number];

/** Mensagem de suporte recebida, com o campo de resposta do dono. */
function MensagemSuporte({ m, onMudou }: { m: Mensagem; onMudou: () => void }) {
  const [resposta, setResposta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  async function responder() {
    setError(""); setEnviando(true);
    try {
      await api(`/api/dono/mensagens/${m.id}`, { body: { resposta } });
      setResposta("");
      onMudou();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível responder");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{ paddingTop: 10, marginTop: 10, borderTop: "1px solid var(--linha)" }}>
      <p className="sub">
        {m.cliente.nome ?? "Cliente"} · código {m.cliente.codigo}
        {m.cliente.bloqueado ? " · bloqueado" : ""} · {dataHora(m.criadaEm)}
      </p>
      <p style={{ margin: "4px 0" }}>{m.texto}</p>
      {m.resposta ? (
        <p className="sub">Sua resposta: {m.resposta}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            className="field" style={{ minHeight: 70, resize: "vertical" }} maxLength={1000}
            placeholder="Responder ao cliente" value={resposta} onChange={(e) => setResposta(e.target.value)}
          />
          {error && <p className="err">{error}</p>}
          <button className="btn ghost" onClick={responder} disabled={enviando || resposta.trim().length < 2}>
            {enviando ? "Enviando…" : "Responder"}
          </button>
        </div>
      )}
    </div>
  );
}

function PainelLoja({ loja, onMudou }: { loja: LojaDoDono; onMudou: () => void }) {
  const [codigo, setCodigo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [error, setError] = useState("");

  async function bloquear() {
    setError(""); setSalvando(true);
    try {
      await api(`/api/dono/lojas/${loja.id}/bloqueios`, { body: { codigoCliente: codigo, motivo } });
      setCodigo(""); setMotivo("");
      onMudou();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível bloquear");
    } finally {
      setSalvando(false);
    }
  }

  async function desbloquear(id: string, nome: string) {
    if (!confirm(`Liberar a entrada de ${nome} de novo?`)) return;
    try {
      await api(`/api/dono/bloqueios/${id}`, { method: "DELETE" });
      onMudou();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível desbloquear");
    }
  }

  const semResposta = loja.mensagens.filter((m) => !m.resposta).length;

  return (
    <>
      <div className="card">
        <div className="lab">{loja.name}{loja.active ? "" : " · fechada"}</div>
        <p className="sub">{[loja.address, `${loja.city}/${loja.state}`].filter(Boolean).join(" · ")}</p>
        <p className="sub">Capacidade: {loja.capacidade} pessoas por vez.</p>
      </div>

      <div className="card">
        <div className="lab">Mensagens de clientes{semResposta > 0 ? ` · ${semResposta} sem resposta` : ""}</div>
        {loja.mensagens.length === 0 ? (
          <p className="sub">Nenhuma mensagem recebida.</p>
        ) : (
          loja.mensagens.map((m) => <MensagemSuporte key={m.id} m={m} onMudou={onMudou} />)
        )}
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="lab">Clientes bloqueados</div>
        {loja.bloqueios.length === 0 && <p className="sub">Ninguém bloqueado nesta loja.</p>}
        {loja.bloqueios.map((b) => (
          <div key={b.id} className="item">
            <span>
              {b.cliente.nome ?? "Cliente"} · código {b.cliente.codigo}
              <span className="sub" style={{ display: "block" }}>{b.motivo} · desde {dataHora(b.criadoEm)}</span>
            </span>
            <button className="btn-mini" onClick={() => desbloquear(b.id, b.cliente.nome ?? "este cliente")}>
              Desbloquear
            </button>
          </div>
        ))}
        <p className="sub" style={{ marginTop: 6 }}>
          Para bloquear a entrada de alguém por problema de conduta, informe o código do cliente e o motivo. O
          cliente não vê o motivo, só que está bloqueado e o caminho do suporte.
        </p>
        <input
          className="field" inputMode="numeric" placeholder="Código do cliente"
          value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
        />
        <input
          className="field" placeholder="Motivo (fica só com você)" maxLength={300}
          value={motivo} onChange={(e) => setMotivo(e.target.value)}
        />
        {error && <p className="err">{error}</p>}
        <button className="btn" onClick={bloquear} disabled={salvando || !codigo || motivo.trim().length < 3}>
          {salvando ? "Bloqueando…" : "Bloquear cliente"}
        </button>
      </div>
    </>
  );
}

/**
 * Área do dono de loja — só mostra as lojas em que a pessoa é o dono (o
 * admin faz esse vínculo em /admin/lojas, depois de aprovar o pedido de
 * Dono de loja). Aqui ele responde o suporte e bloqueia/desbloqueia clientes.
 */
export default function MinhaLoja() {
  const router = useRouter();
  const [lojas, setLojas] = useState<LojaDoDono[] | null>(null);

  const carregar = useCallback(() => {
    api<{ lojas: LojaDoDono[] }>("/api/dono/lojas")
      .then((r) => setLojas(r.lojas))
      .catch(() => router.replace("/app/login"));
  }, [router]);

  useEffect(() => {
    if (!getToken()) { router.replace("/app/cadastro"); return; }
    carregar();
  }, [router, carregar]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1>Minha loja</h1>
      {lojas === null ? (
        <p className="sub">Carregando…</p>
      ) : lojas.length === 0 ? (
        <p className="sub">
          Nenhuma loja está vinculada a você ainda. Depois que seu pedido de Dono de loja é aprovado, o
          administrador vincula a loja ao seu cadastro.
        </p>
      ) : (
        lojas.map((l) => <PainelLoja key={l.id} loja={l} onMudou={carregar} />)
      )}
      <Link className="btn ghost" href="/app/loja">Voltar</Link>
    </div>
  );
}
