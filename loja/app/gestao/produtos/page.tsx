import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { reais } from "@/lib/dinheiro";
import { pode } from "@/lib/permissoes";
import { exigirGestao } from "@/lib/sessao";
import { Nav } from "../nav";
import { carregarExemplos, criarProduto } from "./actions";
import { CamposProduto } from "./CamposProduto";

export const dynamic = "force-dynamic";

/** Estoque completo, com busca por nome ou código de barras, e o cadastro
 *  de produto novo. */
export default async function Produtos({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; erro?: string; inativos?: string }>;
}) {
  const { loja, usuario } = await exigirGestao();
  const { q: qParam, erro, inativos } = await searchParams;
  const q = qParam?.trim() ?? "";
  const soNumeros = q.replace(/\D/g, "");

  const [produtos, total] = await Promise.all([
    prisma.produto.findMany({
      where: {
        ...(inativos ? {} : { ativo: true }),
        ...(q
          ? { OR: [{ nome: { contains: q } }, ...(soNumeros ? [{ ean: { contains: soNumeros } }] : [])] }
          : {}),
      },
      orderBy: { nome: "asc" },
    }),
    prisma.produto.count(),
  ]);

  return (
    <main className="admin-wrap">
      <Nav loja={loja} usuario={usuario} atual="/gestao/produtos" />

      <form method="get" className="linha-form">
        <label className="rotulo" style={{ flex: 1 }}>
          Buscar por nome ou código de barras
          <input className="field" name="q" defaultValue={q} autoFocus />
        </label>
        <label className="sub" style={{ display: "flex", gap: 6, alignItems: "center", height: 40 }}>
          <input type="checkbox" name="inativos" value="1" defaultChecked={!!inativos} /> mostrar inativos
        </label>
        <button className="btn ghost" type="submit" style={{ height: 40 }}>Buscar</button>
      </form>

      <h2 className="section-title">Estoque ({produtos.length})</h2>
      {produtos.length === 0 ? (
        <p className="sub">{total === 0 ? "Nenhum produto cadastrado ainda." : "Nenhum produto encontrado."}</p>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Produto</th><th>Código de barras</th><th>Estoque</th><th>Mínimo</th><th>Preço</th><th>Custo</th>
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
                  <td>{p.precoCents === null ? <span className="chip at">sem preço</span> : reais(p.precoCents)}</td>
                  <td>{reais(p.custoCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {erro && <p className="err-msg" style={{ marginTop: 16 }}>{erro}</p>}
      {pode(usuario, "PRODUTOS") && (
        <>
          <h2 className="section-title">Novo produto</h2>
          <form action={criarProduto} className="card" style={{ display: "grid", gap: 12 }}>
            <CamposProduto />
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
