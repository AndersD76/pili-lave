import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { reais } from "@/lib/dinheiro";
import { pode } from "@/lib/permissoes";
import { formatarPercentual } from "@/lib/precos";
import { exigirGestao } from "@/lib/sessao";
import { Nav } from "../nav";
import { carregarExemplos, criarProduto, definirPercentuais } from "./actions";
import { CamposProduto } from "./CamposProduto";

export const dynamic = "force-dynamic";

type Filtro = "todos" | "sempct" | "manual";

/**
 * Estoque completo, com busca por nome ou código de barras, e o cadastro de
 * produto novo. Duas abas servem ao controle de preço:
 *  - "Sem percentual": produtos que ainda não têm percentual de venda — o
 *    objetivo é essa lista ficar vazia, pra todo preço acompanhar o custo.
 *  - "Sem reajuste automático": produtos com preço fixado à mão, que NÃO
 *    mudam quando chega nota com custo novo. O lojista precisa saber quais são.
 */
export default async function Produtos({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; erro?: string; ok?: string; inativos?: string; f?: string }>;
}) {
  const { loja, usuario } = await exigirGestao();
  const { q: qParam, erro, ok, inativos, f } = await searchParams;
  const q = qParam?.trim() ?? "";
  const soNumeros = q.replace(/\D/g, "");
  const filtro: Filtro = f === "sempct" || f === "manual" ? f : "todos";
  const podePreco = pode(usuario, "PRECO");

  const semPct = { ativo: true, precoManual: false, margemPct: null };
  const manual = { ativo: true, precoManual: true };
  const [produtos, total, nSemPct, nManual] = await Promise.all([
    prisma.produto.findMany({
      where: {
        ...(filtro === "sempct" ? semPct : filtro === "manual" ? manual : inativos ? {} : { ativo: true }),
        ...(q
          ? { OR: [{ nome: { contains: q } }, ...(soNumeros ? [{ ean: { contains: soNumeros } }] : [])] }
          : {}),
      },
      orderBy: { nome: "asc" },
    }),
    prisma.produto.count(),
    prisma.produto.count({ where: semPct }),
    prisma.produto.count({ where: manual }),
  ]);
  const editaPct = filtro === "sempct" && podePreco && produtos.length > 0;

  const abas: { k: Filtro; rotulo: string; n?: number }[] = [
    { k: "todos", rotulo: "Todos" },
    { k: "sempct", rotulo: "Sem percentual", n: nSemPct },
    { k: "manual", rotulo: "Sem reajuste automático", n: nManual },
  ];

  const tabela = (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Produto</th><th>Código de barras</th><th>Estoque</th><th>Mínimo</th><th>Custo</th><th>% de venda</th><th>Preço</th>
          </tr>
        </thead>
        <tbody>
          {produtos.map((p) => (
            <tr key={p.id} style={p.ativo ? undefined : { opacity: 0.5 }}>
              <td><Link href={`/gestao/produtos/${p.id}`}>{p.nome}</Link>{p.ativo ? "" : " (inativo)"}</td>
              <td>{p.ean ?? "—"}</td>
              <td>
                <span className={`chip ${p.estoqueAtual <= 0 ? "err" : p.estoqueAtual <= p.estoqueMinimo ? "at" : "ok"}`}>
                  {p.estoqueAtual} {p.unidade}
                </span>
              </td>
              <td>{p.estoqueMinimo}</td>
              <td>{reais(p.custoCents)}</td>
              <td>
                {editaPct ? (
                  <input
                    className="field" name={`pct_${p.id}`} inputMode="decimal" placeholder="ex.: 40"
                    style={{ width: 100, height: 36, fontSize: 14, padding: "0 10px" }}
                  />
                ) : p.precoManual ? (
                  <span className="chip off">manual</span>
                ) : p.margemPct === null ? (
                  <span className="chip at">sem %</span>
                ) : (
                  formatarPercentual(p.margemPct)
                )}
              </td>
              <td>{p.precoCents === null ? <span className="chip at">sem preço</span> : reais(p.precoCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <main className="admin-wrap">
      <Nav loja={loja} usuario={usuario} atual="/gestao/produtos" />

      <form method="get" className="linha-form">
        {filtro !== "todos" && <input type="hidden" name="f" value={filtro} />}
        <label className="rotulo" style={{ flex: 1 }}>
          Buscar por nome ou código de barras
          <input className="field" name="q" defaultValue={q} autoFocus />
        </label>
        {filtro === "todos" && (
          <label className="sub" style={{ display: "flex", gap: 6, alignItems: "center", height: 40 }}>
            <input type="checkbox" name="inativos" value="1" defaultChecked={!!inativos} /> mostrar inativos
          </label>
        )}
        <button className="btn ghost" type="submit" style={{ height: 40 }}>Buscar</button>
      </form>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
        {abas.map((a) => (
          <Link
            key={a.k} href={a.k === "todos" ? "/gestao/produtos" : `/gestao/produtos?f=${a.k}`}
            className={`btn ${a.k === filtro ? "" : "ghost"}`}
            style={{ height: 36, padding: "0 16px", fontSize: 13, display: "inline-flex", alignItems: "center" }}
          >
            {a.rotulo}{a.n !== undefined ? ` (${a.n})` : ""}
          </Link>
        ))}
      </div>

      {filtro === "sempct" && (
        <p className="sub" style={{ marginTop: 12 }}>
          Produtos sem percentual de venda: o preço deles não acompanha o custo.
          {podePreco
            ? " Preencha o percentual de cada um (40 = custo mais 40%) e clique em Salvar percentuais. O preço é recalculado na hora."
            : " Só quem pode alterar preço define o percentual."}
        </p>
      )}
      {filtro === "manual" && (
        <p className="sub" style={{ marginTop: 12 }}>
          Estes produtos têm <b>preço manual</b>: não são reajustados quando chega nota fiscal com custo novo. Para
          voltar ao reajuste automático, abra o produto e desmarque &quot;Preço manual&quot;.
        </p>
      )}
      {erro && <p className="err-msg" style={{ marginTop: 12 }}>{erro}</p>}
      {ok && <p className="ok-msg" style={{ marginTop: 12 }}>Salvo.</p>}

      <h2 className="section-title">
        {filtro === "sempct" ? "Sem percentual" : filtro === "manual" ? "Sem reajuste automático" : "Estoque"} ({produtos.length})
      </h2>
      {produtos.length === 0 ? (
        <p className="sub">
          {filtro === "sempct"
            ? "Todos os produtos têm percentual de venda (ou preço manual)."
            : filtro === "manual"
            ? "Nenhum produto com preço manual: todos são reajustados automaticamente."
            : total === 0 ? "Nenhum produto cadastrado ainda." : "Nenhum produto encontrado."}
        </p>
      ) : editaPct ? (
        <form action={definirPercentuais}>
          {tabela}
          <button className="btn" type="submit" style={{ marginTop: 12 }}>Salvar percentuais</button>
        </form>
      ) : (
        tabela
      )}

      {filtro === "todos" && pode(usuario, "PRODUTOS") && (
        <>
          <h2 className="section-title">Novo produto</h2>
          <form action={criarProduto} className="card" style={{ display: "grid", gap: 12 }}>
            <CamposProduto podePreco={podePreco} />
            {pode(usuario, "ENTRADA") && (
              <label className="rotulo" style={{ width: 130 }}>
                Estoque inicial
                <input className="field" name="estoqueInicial" defaultValue={0} inputMode="numeric" />
              </label>
            )}
            <button className="btn" type="submit" style={{ justifySelf: "start" }}>Cadastrar produto</button>
          </form>
        </>
      )}

      {total === 0 && usuario.papel === "LOJISTA" && (
        <form action={carregarExemplos} style={{ marginTop: 16 }}>
          <button className="btn ghost" type="submit">Carregar 5 produtos de exemplo (só para teste)</button>
        </form>
      )}
    </main>
  );
}
