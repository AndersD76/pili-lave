import Link from "next/link";
import { notFound } from "next/navigation";
import { reais } from "@/lib/dinheiro";
import { pode } from "@/lib/permissoes";
import { formatarCnpj, lerNfe } from "@/lib/nfe";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/sessao";
import { Nav } from "../../../nav";
import { confirmarNota, descartarNota } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * Conferência da nota antes de dar entrada. Pra cada item o sistema já
 * sugere o produto da loja: pelo código de barras; ou, se a nota não traz,
 * pelo que foi escolhido na última nota desse fornecedor. O que ele não
 * reconhece vem marcado como "criar produto novo".
 */
export default async function ConferirNota({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { loja, usuario } = await exigirPermissao("ENTRADA");
  const { id } = await params;
  const { erro } = await searchParams;
  const pendente = await prisma.notaPendente.findUnique({ where: { id } });
  if (!pendente) notFound();
  const leitura = lerNfe(pendente.xml);
  if (!leitura.ok) notFound();
  const { nota } = leitura;

  const [produtos, fornecedor] = await Promise.all([
    prisma.produto.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true, ean: true, precoCents: true } }),
    nota.fornecedor.cnpj
      ? prisma.fornecedor.findUnique({ where: { cnpj: nota.fornecedor.cnpj }, include: { codigos: true } })
      : null,
  ]);
  const porEan = new Map(produtos.filter((p) => p.ean).map((p) => [p.ean!, p.id]));
  const porCodigo = new Map((fornecedor?.codigos ?? []).map((c) => [c.codigo, c.produtoId]));
  const ativos = new Set(produtos.map((p) => p.id));

  const linhas = nota.itens.map((item) => {
    const peloEan = item.ean ? porEan.get(item.ean) : undefined;
    const pelaMemoria = porCodigo.get(item.codigoFornecedor);
    const sugerido = peloEan ?? (pelaMemoria && ativos.has(pelaMemoria) ? pelaMemoria : undefined);
    return {
      item, sugerido,
      motivo: peloEan ? "código de barras" : sugerido ? "última nota deste fornecedor" : null,
    };
  });
  const novos = linhas.filter((l) => !l.sugerido).length;
  const podePreco = pode(usuario, "PRECO");
  const precoDe = new Map(produtos.map((p) => [p.id, p.precoCents]));

  return (
    <main className="admin-wrap">
      <Nav loja={loja} usuario={usuario} atual="/gestao/entradas" />
      <p><Link href="/gestao/entradas">← Entradas</Link></p>
      <h1 style={{ margin: "8px 0 4px" }}>Conferir nota {nota.numero}</h1>
      <p className="sub">
        {nota.fornecedor.nome}{nota.fornecedor.cnpj ? ` · CNPJ ${formatarCnpj(nota.fornecedor.cnpj)}` : ""}
        {nota.emissao ? ` · emitida em ${nota.emissao.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}
        {" · "}total {reais(nota.totalCents)}
      </p>
      {erro && <p className="err-msg" style={{ marginTop: 10 }}>{erro}</p>}

      <form action={confirmarNota}>
        <input type="hidden" name="id" value={pendente.id} />
        <h2 className="section-title">Itens da nota ({linhas.length})</h2>
        <p className="sub" style={{ marginBottom: 10 }}>
          Confira o produto e a quantidade em <b>unidades de venda</b> de cada item. Se a nota veio em caixas,
          corrija para o número de unidades que vão para a prateleira.
          {novos > 0 && ` ${novos} ${novos === 1 ? "item não foi reconhecido" : "itens não foram reconhecidos"} e será criado como produto novo, sem preço de venda.`}
        </p>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Item da nota</th><th>Veio como</th><th>Produto na loja</th><th>Unidades</th><th>Total do item</th>
                {podePreco && <th>Preço de venda</th>}
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ item, sugerido, motivo }, i) => (
                <tr key={i}>
                  <td>
                    {item.descricao}
                    <span className="sub" style={{ display: "block", fontSize: 12 }}>
                      cód. fornecedor {item.codigoFornecedor || "—"} · {item.ean ? `EAN ${item.ean}` : "sem código de barras"}
                    </span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{item.comoVeio}</td>
                  <td>
                    <select className="field" name={`acao_${i}`} defaultValue={sugerido ?? "novo"} style={{ height: 38, fontSize: 14, padding: "0 10px", minWidth: 240 }}>
                      <option value="novo">+ Criar produto novo</option>
                      <option value="ignorar">Não dar entrada neste item</option>
                      {produtos.map((p) => (
                        <option key={p.id} value={p.id}>{p.nome}{p.ean ? ` (${p.ean})` : ""}</option>
                      ))}
                    </select>
                    <span className="sub" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
                      {motivo ? `Reconhecido pelo ${motivo === "código de barras" ? "código de barras" : "que foi escolhido na última nota deste fornecedor"}` : "Não reconhecido"}
                    </span>
                  </td>
                  <td>
                    <input className="field" name={`qtd_${i}`} defaultValue={item.quantidade || ""} inputMode="numeric" style={{ width: 90, height: 38, fontSize: 14, padding: "0 10px" }} />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {reais(item.totalCents)}
                    {item.quantidade > 0 && (
                      <span className="sub" style={{ display: "block", fontSize: 12 }}>
                        {reais(Math.round(item.totalCents / item.quantidade))} por unidade
                      </span>
                    )}
                  </td>
                  {podePreco && (
                    <td>
                      <input
                        className="field" name={`preco_${i}`} inputMode="decimal" placeholder="30% ou 5,90"
                        style={{ width: 120, height: 38, fontSize: 14, padding: "0 10px" }}
                      />
                      <span className="sub" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
                        {sugerido && precoDe.get(sugerido) != null ? `hoje ${reais(precoDe.get(sugerido)!)}` : "sem preço hoje"}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub" style={{ marginTop: 10 }}>
          O custo de cada produto passa a ser o total do item dividido pelas unidades informadas.
          {podePreco && " Na coluna Preço de venda, digite um percentual sobre esse custo (30% = custo mais 30%) ou o preço direto (5,90). Em branco, o preço do produto não muda."}
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn" type="submit">Confirmar e dar entrada</button>
        </div>
      </form>
      <form action={descartarNota} style={{ marginTop: 10 }}>
        <input type="hidden" name="id" value={pendente.id} />
        <button className="btn ghost" type="submit">Descartar esta nota</button>
      </form>
    </main>
  );
}
