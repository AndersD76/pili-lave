import { lerLista } from "@/lib/alertas";
import { prisma } from "@/lib/prisma";
import { exigirLojista } from "@/lib/sessao";
import { lerSuspeitos, lerTrajetos } from "@/lib/trajetos";
import { Nav } from "../nav";
import { revisarDivergencia } from "./actions";

export const dynamic = "force-dynamic";

function dataHora(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function nomes(json: string): string {
  try {
    const lista = JSON.parse(json) as { nome: string; codigoCliente?: string | null }[];
    return lista.map((v) => (v.codigoCliente ? `${v.nome} (código ${v.codigoCliente})` : v.nome)).join(", ");
  } catch {
    return "";
  }
}

/** Períodos em que o que saiu das prateleiras não bateu com o que foi pago,
 *  com as imagens do momento. Só o lojista vê e decide. */
export default async function Divergencias({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { loja, usuario } = await exigirLojista();
  const { erro, ok } = await searchParams;
  const [divergencias, cameras] = await Promise.all([
    prisma.divergencia.findMany({
      orderBy: [{ situacao: "asc" }, { criadaEm: "desc" }], take: 50,
      include: { eventos: { orderBy: { ocorridoEm: "asc" } } },
    }),
    prisma.eventoVisao.findMany({ where: { tipo: "CAMERA" }, orderBy: { ocorridoEm: "desc" }, take: 5 }),
  ]);
  const abertas = divergencias.filter((d) => d.situacao === "ABERTA").length;

  return (
    <main className="admin-wrap">
      <Nav loja={loja} usuario={usuario} atual="/gestao/divergencias" />
      {erro && <p className="err-msg" style={{ marginBottom: 10 }}>{erro}</p>}
      {ok && <p className="ok-msg" style={{ marginBottom: 10 }}>Divergência revisada.</p>}

      <h2 className="section-title">Divergências de estoque ({abertas} aguardando revisão)</h2>
      <p className="sub" style={{ marginBottom: 14 }}>
        Sempre que a loja esvazia, o sistema compara o que as câmeras viram sair das prateleiras com o que foi pago no caixa.
        Quando não bate, aparece aqui. Nenhuma cobrança é feita sozinha: a decisão é sua.
      </p>

      {divergencias.length === 0 && <p className="sub">Nenhuma divergência registrada.</p>}
      {divergencias.map((d) => (
        <div key={d.id} className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <strong>{dataHora(d.inicio)} → {dataHora(d.fim)}</strong>
            <span className={`chip ${d.situacao === "ABERTA" ? "at" : "ok"}`}>{d.situacao === "ABERTA" ? "Aguardando revisão" : "Revisada"}</span>
          </div>
          <p style={{ marginTop: 8 }}>
            Saíram das prateleiras: <strong>{d.saiuPrateleira}</strong> · Pagas no caixa: <strong>{d.pago}</strong> · Diferença:{" "}
            <strong>{d.saiuPrateleira - d.pago > 0 ? "+" : ""}{d.saiuPrateleira - d.pago}</strong>
          </p>
          <p className="sub" style={{ marginTop: 4 }}>
            {nomes(d.visitas) ? `Na loja no período: ${nomes(d.visitas)}` : "Ninguém com entrada registrada no período."}
          </p>

          {d.eventos.map((e) => {
            const imagens = lerLista(e.imagens);
            return (
              <div key={e.id} style={{ marginTop: 12 }}>
                <span className="sub">
                  {dataHora(e.ocorridoEm)} · zona {e.zona ?? "?"} · {e.delta > 0 ? "+" : ""}{e.delta} un.
                  {e.ambiguo ? " · mais de uma pessoa na zona" : ""}
                  {e.detalhe ? ` · ${e.detalhe}` : ""}
                </span>
                {imagens.length > 0 && (
                  <div className="evidencias">
                    {imagens.map((_, i) => (
                      <a key={i} href={`/gestao/divergencias/imagem?evento=${e.id}&i=${i}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/gestao/divergencias/imagem?evento=${e.id}&i=${i}`} alt={`Imagem ${i + 1} da zona ${e.zona ?? ""}`} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {lerSuspeitos(d.suspeitos).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <strong>Trajeto de quem esteve junto às prateleiras</strong>
              <p className="sub" style={{ marginTop: 2 }}>
                Percurso de cada pessoa dentro da loja, montado pelas câmeras. Serve para você conferir; não é uma acusação.
              </p>
              {lerSuspeitos(d.suspeitos).map((s) => {
                const t = lerTrajetos(d.trajetos).find((x) => x.visitaId === s.visitaId);
                return (
                  <div key={s.visitaId} style={{ marginTop: 10 }}>
                    <span className="sub">
                      <strong>{s.nome}</strong>{s.codigoCliente ? ` (código ${s.codigoCliente})` : ""} — {t ? t.resumo : "aguardando o programa das câmeras montar o trajeto…"}
                    </span>
                    {t && t.imagens.length > 0 && (
                      <div className="evidencias">
                        {t.imagens.map((_, i) => {
                          const src = `/gestao/divergencias/imagem?divergencia=${d.id}&visita=${encodeURIComponent(s.visitaId)}&i=${i}`;
                          return (
                            <a key={i} href={src} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={src} alt={i === 0 ? `Mapa do trajeto de ${s.nome}` : `Fotos do trajeto de ${s.nome}`} />
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {d.situacao === "ABERTA" ? (
            <form action={revisarDivergencia} className="linha-form" style={{ marginTop: 14 }}>
              <input type="hidden" name="id" value={d.id} />
              <label className="rotulo" style={{ flex: 1, minWidth: 260 }}>
                O que foi decidido
                <input className="field" name="decisao" required placeholder="Ex.: conferi as imagens, cliente devolveu o item à prateleira" />
              </label>
              <button className="btn ghost" type="submit" style={{ height: 40 }}>Marcar como revisada</button>
            </form>
          ) : (
            <p className="sub" style={{ marginTop: 12 }}>
              Revisada por {d.revisadaPor} em {d.revisadaEm ? dataHora(d.revisadaEm) : "—"}: {d.decisao}
            </p>
          )}
        </div>
      ))}

      {cameras.length > 0 && (
        <>
          <h2 className="section-title" style={{ marginTop: 24 }}>Avisos das câmeras</h2>
          <ul className="sub" style={{ paddingLeft: 18 }}>
            {cameras.map((c) => (
              <li key={c.id}>{dataHora(c.ocorridoEm)} — {c.zona ? `${c.zona}: ` : ""}{c.detalhe ?? "evento de câmera"}</li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
