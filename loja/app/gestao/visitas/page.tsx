import { pode } from "@/lib/permissoes";
import { porta } from "@/lib/porta";
import { prisma } from "@/lib/prisma";
import { exigirGestao } from "@/lib/sessao";
import { reposicaoAtiva, visitasAtivas } from "@/lib/visitas";
import { Nav } from "../nav";
import { abrirPortaAction, encerrarReposicaoAction, iniciarReposicaoAction, registrarSaidaAction } from "./actions";

export const dynamic = "force-dynamic";

const ROTULO_ORIGEM: Record<string, string> = { CATRACA: "Catraca", BLE: "App (BLE)", MANUAL: "Manual", REMOTA: "Abertura remota" };
const MENSAGEM_OK: Record<string, string> = {
  "reposicao-iniciada": "Reposição iniciada. A loja está bloqueada para clientes.",
  "reposicao-encerrada": "Reposição encerrada. A loja está liberada.",
  saida: "Saída registrada.",
  porta: "Porta aberta.",
};

function dataHora(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Quem está dentro da loja agora, o modo reposição e o histórico de visitas. */
export default async function Visitas({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { loja, usuario } = await exigirGestao();
  const { erro, ok } = await searchParams;
  const lojista = usuario.papel === "LOJISTA";
  const [ativas, reposicao, historico] = await Promise.all([
    visitasAtivas(),
    reposicaoAtiva(),
    prisma.visita.findMany({ where: { saiuEm: { not: null } }, orderBy: { entrouEm: "desc" }, take: 100 }),
  ]);

  return (
    <main className="admin-wrap">
      <Nav loja={loja} usuario={usuario} atual="/gestao/visitas" />
      {erro && <p className="err-msg" style={{ marginBottom: 10 }}>{erro}</p>}
      {ok && MENSAGEM_OK[ok] && <p className="ok-msg" style={{ marginBottom: 10 }}>{MENSAGEM_OK[ok]}</p>}

      <div className="stats">
        <div className="stat">
          <div className="lab">Dentro da loja agora</div>
          <div className="val">{ativas.length} / {loja.capacidade}</div>
        </div>
        <div className="stat">
          <div className="lab">Situação</div>
          <div className="val" style={{ fontSize: 20 }}>{reposicao ? "Em reposição" : "Aberta a clientes"}</div>
        </div>
      </div>

      <h2 className="section-title">Modo reposição</h2>
      <div className="card" style={{ marginBottom: 20 }}>
        {reposicao ? (
          <>
            <p>
              Reposição em andamento desde {dataHora(reposicao.inicio)}, por <strong>{reposicao.usuarioNome}</strong>. Clientes não
              entram, e o que mudar nas prateleiras não gera divergência.
            </p>
            {pode(usuario, "REPOSICAO") && (
              <form action={encerrarReposicaoAction} style={{ marginTop: 12 }}>
                <button className="btn" type="submit">Encerrar reposição</button>
              </form>
            )}
          </>
        ) : (
          <>
            <p className="sub">
              Durante a reposição a loja fica bloqueada para clientes (o app mostra &quot;Em reposição de estoque. Por favor aguarde um
              pouco&quot;) e tudo o que mudar nas prateleiras fica no nome de quem está repondo.
            </p>
            {pode(usuario, "REPOSICAO") ? (
              <form action={iniciarReposicaoAction} style={{ marginTop: 12 }}>
                <button className="btn" type="submit">Iniciar reposição</button>
              </form>
            ) : (
              <p className="sub" style={{ marginTop: 8 }}>Você não tem a permissão &quot;Fazer reposição&quot;.</p>
            )}
          </>
        )}
      </div>

      {lojista && (
        <>
          <h2 className="section-title">Abrir a porta</h2>
          <form action={abrirPortaAction} className="card linha-form" style={{ marginBottom: 20 }}>
            <label className="rotulo" style={{ flex: 1, minWidth: 240 }}>
              Motivo (fica registrado no seu nome)
              <input className="field" name="motivo" required placeholder="Ex.: entregador da distribuidora" />
            </label>
            <button className="btn ghost" type="submit" style={{ height: 40 }}>Abrir agora</button>
            <span className="sub" style={{ flexBasis: "100%" }}>Equipamento: {porta.nome}</span>
          </form>
        </>
      )}

      <h2 className="section-title">Quem está dentro ({ativas.length})</h2>
      {ativas.length === 0 ? (
        <p className="sub" style={{ marginBottom: 20 }}>Ninguém com entrada registrada.</p>
      ) : (
        <div className="tbl-wrap" style={{ marginBottom: 20 }}>
          <table className="tbl">
            <thead><tr><th>Cliente</th><th>Código</th><th>Entrou</th><th>Crianças</th><th>Por</th><th>Compra</th><th></th></tr></thead>
            <tbody>
              {ativas.map((v) => (
                <tr key={v.id}>
                  <td>{v.nome}</td>
                  <td>{v.codigoCliente ?? "—"}</td>
                  <td>{dataHora(v.entrouEm)}</td>
                  <td>{v.criancas || "—"}</td>
                  <td>{ROTULO_ORIGEM[v.origem] ?? v.origem}</td>
                  <td>{v.vendaId ? `Venda nº ${v.vendaId}` : "—"}</td>
                  <td>
                    {lojista && (
                      <form action={registrarSaidaAction}>
                        <input type="hidden" name="visitaId" value={v.id} />
                        <button className="btn ghost" type="submit" style={{ height: 32 }}>Registrar saída</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section-title">Últimas visitas ({historico.length})</h2>
      {historico.length === 0 ? (
        <p className="sub">Nenhuma visita encerrada ainda.</p>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Cliente</th><th>Código</th><th>Entrou</th><th>Saiu</th><th>Por</th><th>Compra</th></tr></thead>
            <tbody>
              {historico.map((v) => (
                <tr key={v.id}>
                  <td>{v.nome}</td>
                  <td>{v.codigoCliente ?? "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{dataHora(v.entrouEm)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{v.saiuEm ? dataHora(v.saiuEm) : "—"}</td>
                  <td>{ROTULO_ORIGEM[v.origem] ?? v.origem}</td>
                  <td>
                    {v.vendaId ? `Venda nº ${v.vendaId}` : v.saiuSemPagar ? <span className="chip at">Saiu sem compra</span> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
