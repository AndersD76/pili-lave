"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, money, type LojaAbertura, type LojaAlerta, type LojaDoDono, type LojaIndicadores } from "../client";

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const SEPARADOR: React.CSSProperties = { paddingTop: 10, marginTop: 10, borderTop: "1px solid var(--linha)" };

/* ------------------------------------------------------------------ avisos */

function Aviso({ a, lojaId, onMudou }: { a: LojaAlerta; lojaId: string; onMudou: () => void }) {
  const [imagens, setImagens] = useState<string[] | null>(null);
  const [motivo, setMotivo] = useState("");
  const [bloqueando, setBloqueando] = useState(false);
  const [error, setError] = useState("");
  const invasaoAberta = a.tipo === "INVASAO" && !a.lidoEm;

  async function tentar(acao: () => Promise<unknown>, falha: string) {
    setError("");
    try { await acao(); } catch (e) { setError(e instanceof Error ? e.message : falha); }
  }
  const verImagens = () =>
    tentar(async () => setImagens((await api<{ imagens: string[] }>(`/api/dono/alertas/${a.id}`)).imagens),
      "Não foi possível carregar as imagens");
  const marcarLido = () =>
    tentar(async () => { await api(`/api/dono/alertas/${a.id}`, { method: "POST" }); onMudou(); },
      "Não foi possível marcar como lido");
  const bloquear = () =>
    tentar(async () => {
      await api(`/api/dono/lojas/${lojaId}/bloqueios`, { body: { codigoCliente: a.codigoCliente, motivo } });
      setBloqueando(false); setMotivo("");
      onMudou();
    }, "Não foi possível bloquear");

  return (
    <div
      style={{
        ...SEPARADOR,
        ...(invasaoAberta
          ? { border: "2px solid var(--erro)", borderRadius: 12, padding: 12, background: "rgba(255, 90, 77, 0.10)" }
          : {}),
      }}
    >
      <p style={{ margin: 0, fontWeight: 700, color: invasaoAberta ? "var(--erro)" : undefined }}>
        {a.lidoEm ? "" : "● "}{a.titulo}
      </p>
      <p className="sub">{dataHora(a.ocorridoEm)}{a.codigoCliente ? ` · cliente código ${a.codigoCliente}` : ""}</p>
      {a.detalhe && <p style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{a.detalhe}</p>}

      {imagens?.map((b64, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i} src={`data:image/jpeg;base64,${b64}`} alt={`Imagem ${i + 1} do aviso`}
          style={{ width: "100%", borderRadius: 10, marginTop: 8, display: "block" }}
        />
      ))}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {a.imagens > 0 && !imagens && (
          <button className="btn-mini" onClick={verImagens}>
            Ver {a.imagens === 1 ? "imagem" : `${a.imagens} imagens`}
          </button>
        )}
        {!a.lidoEm && <button className="btn-mini" onClick={marcarLido}>Marcar como lido</button>}
        {a.codigoCliente && !a.clienteBloqueado && !bloqueando && (
          <button className="btn-mini" onClick={() => setBloqueando(true)}>Bloquear este cliente</button>
        )}
      </div>
      {a.clienteBloqueado && <p className="sub">Este cliente já está bloqueado nesta loja.</p>}

      {bloqueando && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <input
            className="field" placeholder="Motivo do bloqueio (fica só com você)" maxLength={300}
            value={motivo} onChange={(e) => setMotivo(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn danger" onClick={bloquear} disabled={motivo.trim().length < 3}>
              Bloquear cliente {a.codigoCliente}
            </button>
            <button className="btn ghost" onClick={() => setBloqueando(false)}>Cancelar</button>
          </div>
        </div>
      )}
      {error && <p className="err">{error}</p>}
    </div>
  );
}

/** Avisos que o computador da loja mandou: invasão, divergência de
 *  prateleira, saída sem pagar, estoque no mínimo. */
export function AvisosLoja({ loja, onMudou }: { loja: LojaDoDono; onMudou: () => void }) {
  const [dados, setDados] = useState<{ naoLidos: number; alertas: LojaAlerta[] } | null>(null);
  const [todos, setTodos] = useState(false);

  const carregar = useCallback(() => {
    api<{ naoLidos: number; alertas: LojaAlerta[] }>(`/api/dono/lojas/${loja.id}/alertas`)
      .then(setDados)
      .catch(() => setDados({ naoLidos: 0, alertas: [] }));
  }, [loja.id]);
  // recarrega junto com a loja (loja.alertasNaoLidos muda quando chega aviso novo)
  useEffect(carregar, [carregar, loja.alertasNaoLidos, loja.bloqueios.length]);

  const mudou = () => { carregar(); onMudou(); };
  async function lerTodos() {
    await api(`/api/dono/lojas/${loja.id}/alertas`, { method: "POST" }).catch(() => {});
    mudou();
  }

  const lista = dados?.alertas ?? [];
  const visiveis = todos ? lista : lista.slice(0, 5);

  return (
    <div className="card">
      <div className="lab">Avisos da loja{dados && dados.naoLidos > 0 ? ` · ${dados.naoLidos} não lido(s)` : ""}</div>
      {dados === null ? (
        <p className="sub">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="sub">Nenhum aviso. Invasão, divergência de estoque, saída sem pagar e estoque no mínimo aparecem aqui.</p>
      ) : (
        <>
          {visiveis.map((a) => <Aviso key={a.id} a={a} lojaId={loja.id} onMudou={mudou} />)}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {lista.length > 5 && (
              <button className="btn-mini" onClick={() => setTodos(!todos)}>
                {todos ? "Mostrar menos" : `Ver todos (${lista.length})`}
              </button>
            )}
            {dados.naoLidos > 1 && <button className="btn-mini" onClick={lerTodos}>Marcar todos como lidos</button>}
          </div>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------- abrir a porta */

/** Abertura remota da porta — só o dono, com confirmação; fica registrada. */
export function AbrirPorta({ loja }: { loja: LojaDoDono }) {
  const [motivo, setMotivo] = useState("");
  const [pedido, setPedido] = useState<LojaAbertura | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const parar = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
  useEffect(() => parar, []);

  async function abrir() {
    if (!confirm(`Abrir a porta da ${loja.name} agora? A abertura fica registrada no seu nome.`)) return;
    setError(""); setEnviando(true);
    try {
      const r = await api<{ id: string }>(`/api/dono/lojas/${loja.id}/abrir-porta`, { body: { motivo } });
      setMotivo("");
      setPedido({ id: r.id, motivo, pedidaEm: new Date().toISOString(), feitaEm: null, situacao: "AGUARDANDO" });
      parar();
      // acompanha até a loja confirmar que abriu (ou o pedido expirar)
      timer.current = setInterval(async () => {
        const lista = await api<{ aberturas: LojaAbertura[] }>(`/api/dono/lojas/${loja.id}/abrir-porta`).catch(() => null);
        const atual = lista?.aberturas.find((a) => a.id === r.id);
        if (atual) setPedido(atual);
        if (atual && atual.situacao !== "AGUARDANDO") parar();
      }, 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível pedir a abertura");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="lab">Abrir a porta à distância</div>
      {!loja.temComputador ? (
        <p className="sub">Esta loja ainda não tem computador vinculado.</p>
      ) : (
        <>
          <p className="sub">
            Para um entregador sem cadastro ou um cliente que precisa voltar. Cada abertura fica registrada no seu
            nome. Se a loja estiver sem internet, o pedido expira em 2 minutos sem abrir.
          </p>
          <input
            className="field" placeholder="Motivo (opcional)" maxLength={200}
            value={motivo} onChange={(e) => setMotivo(e.target.value)}
          />
          <button className="btn" onClick={abrir} disabled={enviando || pedido?.situacao === "AGUARDANDO"}>
            {enviando ? "Enviando…" : "Abrir a porta"}
          </button>
          {pedido?.situacao === "AGUARDANDO" && <p className="sub">Pedido enviado. Aguardando a loja abrir…</p>}
          {pedido?.situacao === "ABERTA" && <p className="okmsg">Porta aberta às {dataHora(pedido.feitaEm!)}.</p>}
          {pedido?.situacao === "EXPIRADA" && (
            <p className="err">A loja não respondeu (provavelmente sem internet). A porta não foi aberta.</p>
          )}
          {error && <p className="err">{error}</p>}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ indicadores */

const FORMA: Record<string, string> = { CARTEIRA: "Carteira do app", MAQUININHA: "Cartão" };
const PERIODOS = [{ dias: 7, rotulo: "7 dias" }, { dias: 30, rotulo: "30 dias" }, { dias: 90, rotulo: "90 dias" }];

/** Dia local (AAAA-MM-DD) de hoje menos n dias. */
function diaMenos(n: number): string {
  const d = new Date(Date.now() - n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Grupo({ titulo, linhas }: { titulo: string; linhas: { rotulo: string; vendas: number; totalCents: number }[] }) {
  if (linhas.length === 0) return null;
  const maximo = Math.max(...linhas.map((l) => l.totalCents));
  return (
    <div style={SEPARADOR}>
      <p className="sub" style={{ fontWeight: 700 }}>{titulo}</p>
      {linhas.map((l) => (
        <div key={l.rotulo} style={{ margin: "6px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
            <span>{l.rotulo}</span>
            <span>{l.vendas} · {money(l.totalCents)}</span>
          </div>
          <div style={{ background: "var(--linha)", borderRadius: 4, height: 6, marginTop: 3 }}>
            <div
              style={{
                width: `${maximo > 0 ? Math.round((l.totalCents / maximo) * 100) : 0}%`,
                height: 6, borderRadius: 4, background: "var(--ok)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Indicadores da loja: faturamento, mais vendidos, horários, faixa etária. */
export function IndicadoresLoja({ loja }: { loja: LojaDoDono }) {
  const [dias, setDias] = useState(30);
  const [ind, setInd] = useState<LojaIndicadores | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    api<LojaIndicadores>(`/api/dono/lojas/${loja.id}/indicadores?de=${diaMenos(dias - 1)}&ate=${diaMenos(0)}`)
      .then((r) => { if (vivo) { setInd(r); setError(""); } })
      .catch(() => { if (vivo) setError("Não foi possível carregar os indicadores."); });
    return () => { vivo = false; };
  }, [loja.id, dias]);

  return (
    <div className="card">
      <div className="lab">Indicadores</div>
      <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
        {PERIODOS.map((p) => (
          <button
            key={p.dias} className="btn-mini" onClick={() => setDias(p.dias)}
            style={p.dias === dias ? { borderColor: "var(--cromo)", fontWeight: 700 } : undefined}
          >
            {p.rotulo}
          </button>
        ))}
      </div>
      {error && <p className="err">{error}</p>}
      {!ind ? (
        error ? null : <p className="sub">Carregando…</p>
      ) : (
        <>
          <p style={{ fontSize: 28, fontWeight: 800, margin: "4px 0" }}>{money(ind.faturamentoCents)}</p>
          <p className="sub">
            {ind.vendas} {ind.vendas === 1 ? "venda" : "vendas"} · ticket médio {money(ind.ticketMedioCents)}
          </p>
          {ind.vendas === 0 ? (
            <p className="sub" style={{ marginTop: 8 }}>Sem vendas sincronizadas neste período.</p>
          ) : (
            <>
              <div style={SEPARADOR}>
                <p className="sub" style={{ fontWeight: 700 }}>Itens mais vendidos</p>
                {ind.maisVendidos.map((i) => (
                  <div key={i.ean ?? i.nome} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, margin: "6px 0" }}>
                    <span>{i.nome}</span>
                    <span>{i.quantidade} un · {money(i.totalCents)}</span>
                  </div>
                ))}
              </div>
              <Grupo titulo="Forma de pagamento" linhas={ind.porForma.map((f) => ({ rotulo: FORMA[f.forma] ?? f.forma, ...f }))} />
              <Grupo titulo="Faixa etária (só compras pela carteira são identificadas)" linhas={ind.faixaEtaria.map((f) => ({ rotulo: f.faixa, ...f }))} />
              <Grupo titulo="Dia da semana" linhas={ind.porDiaSemana.filter((d) => d.vendas > 0).map((d) => ({ rotulo: d.dia, ...d }))} />
              <Grupo titulo="Horário" linhas={ind.porHora.filter((h) => h.vendas > 0).map((h) => ({ rotulo: `${h.hora}h às ${h.hora + 1}h`, ...h }))} />
            </>
          )}
        </>
      )}
    </div>
  );
}
