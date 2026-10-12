"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, getToken, money, type Loja, type Me } from "../client";
import { Logo } from "../Logo";

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Uma loja na lista: situação do cliente nela (liberado/bloqueado) e o
 *  canal de suporte — é por ele que quem foi bloqueado fala com o dono. */
function CartaoLoja({ loja, onEnviada }: { loja: Loja; onEnviada: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  async function enviar() {
    setError(""); setEnviando(true);
    try {
      await api(`/api/lojas/${loja.id}/suporte`, { body: { texto } });
      setTexto(""); setAberto(false);
      onEnviada();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível enviar a mensagem");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="card" style={loja.bloqueado ? { borderColor: "var(--erro)" } : undefined}>
      <div className="lab">{loja.name}</div>
      <p className="sub">{[loja.address, `${loja.city}/${loja.state}`].filter(Boolean).join(" · ")}</p>
      {loja.bloqueado ? (
        <p className="sub" style={{ color: "var(--erro)", marginTop: 8 }}>
          Sua entrada nesta loja está bloqueada. Entre em contato com o suporte: sua mensagem é encaminhada ao
          responsável pela loja, e a resposta pode demorar até 24 horas.
        </p>
      ) : (
        <p className="sub" style={{ marginTop: 8 }}>Capacidade: {loja.capacidade} pessoas por vez.</p>
      )}

      {loja.mensagens.map((m) => (
        <div key={m.id} style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--linha)" }}>
          <p className="sub">Você, {dataHora(m.criadaEm)}: {m.texto}</p>
          <p className="sub" style={{ color: m.resposta ? "var(--cromo)" : undefined }}>
            {m.resposta ? `Resposta da loja: ${m.resposta}` : "Aguardando resposta (até 24 horas)."}
          </p>
        </div>
      ))}

      {aberto ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          <textarea
            className="field" style={{ minHeight: 90, resize: "vertical" }} maxLength={1000}
            placeholder="Escreva sua mensagem para o responsável pela loja"
            value={texto} onChange={(e) => setTexto(e.target.value)}
          />
          {error && <p className="err">{error}</p>}
          <button className="btn" onClick={enviar} disabled={enviando || texto.trim().length < 5}>
            {enviando ? "Enviando…" : "Enviar mensagem"}
          </button>
          <button className="btn ghost" onClick={() => setAberto(false)}>Cancelar</button>
        </div>
      ) : (
        <button className="btn ghost" onClick={() => setAberto(true)} style={{ marginTop: 12 }}>
          Falar com o suporte
        </button>
      )}
    </div>
  );
}

/**
 * Home da loja de conveniência. Só entra quem aceitou o termo E já tirou a
 * foto do rosto (usada pra reconhecer o cliente no caixa) — sem foto, vai
 * direto pra tela de foto.
 */
export default function LojaHome() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [lojas, setLojas] = useState<Loja[] | null>(null);

  const carregarLojas = useCallback(() => {
    api<{ lojas: Loja[] }>("/api/lojas").then((r) => setLojas(r.lojas)).catch(() => setLojas([]));
  }, []);

  useEffect(() => {
    if (!getToken()) { router.replace("/app/cadastro"); return; }
    api<Me>("/api/me")
      .then((m) => {
        if (!m.termosAceitos) { router.replace("/app/termos"); return; }
        if (!m.temFoto) { router.replace("/app/loja/foto"); return; }
        setMe(m);
        carregarLojas();
      })
      .catch(() => router.replace("/app/login"));
  }, [router, carregarLojas]);

  if (!me) return <p className="sub">Carregando…</p>;
  const ehDono = (me.solicitacoes ?? []).some((s) => s.tipo === "DONO_LOJA" && s.status === "APROVADA");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Logo />
        <h1>Loja conveniência</h1>
      </div>
      {ehDono && <Link className="btn" href="/app/minha-loja">Minha loja (área do dono)</Link>}
      <div className="card">
        <div className="lab">Seu código de cliente</div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 32, color: "var(--cromo)" }}>
          {me.codigoCliente}
        </div>
        <p className="sub">É por ele que a loja registra sua entrada.</p>
      </div>
      <div className="card">
        <div className="lab">Saldo disponível</div>
        <div className="money"><span className="cur">R$</span>{money(me.walletCents).replace("R$ ", "")}</div>
        <div style={{ marginTop: 12 }}>
          <Link className="btn ghost" href="/app/recarga">Adicionar saldo</Link>
        </div>
      </div>

      <div className="lab">Lojas</div>
      {lojas === null ? (
        <p className="sub">Carregando…</p>
      ) : lojas.length === 0 ? (
        <p className="sub">Ainda não há lojas abertas. Assim que a primeira estiver funcionando, ela aparece aqui.</p>
      ) : (
        lojas.map((l) => <CartaoLoja key={l.id} loja={l} onEnviada={carregarLojas} />)
      )}

      <Link className="btn ghost" href="/app/loja/foto">Trocar minha foto</Link>
      <Link className="btn ghost" href="/app/escolha">Voltar para a escolha</Link>
    </div>
  );
}
