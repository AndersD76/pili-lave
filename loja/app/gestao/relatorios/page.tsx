import Link from "next/link";
import { reais } from "@/lib/dinheiro";
import {
  lerPeriodo, RELATORIOS, relatorioEntradas, relatorioEstoque, relatorioPerdas, relatorioSaidas, type TipoRelatorio,
} from "@/lib/relatorios";
import { exigirPermissao } from "@/lib/sessao";
import { Nav } from "../nav";

export const dynamic = "force-dynamic";

function dataHora(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function dia(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
function Cartao({ rotulo, valor, nota, alerta }: { rotulo: string; valor: string; nota?: string; alerta?: boolean }) {
  return (
    <div className={`stat${alerta ? " alerta" : ""}`}>
      <div className="lab">{rotulo}</div>
      <div className="val">{valor}</div>
      {nota && <div className="sub">{nota}</div>}
    </div>
  );
}

/** Relatórios: estoque (posição de agora) e, por período, entradas, saídas
 *  (vendas) e perdas. Cada um pode ser baixado em planilha (CSV). */
export default async function Relatorios({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; de?: string; ate?: string }>;
}) {
  const { loja, usuario } = await exigirPermissao("RELATORIOS");
  const sp = await searchParams;
  const tipo: TipoRelatorio = RELATORIOS.some((x) => x.chave === sp.r) ? (sp.r as TipoRelatorio) : "estoque";
  const periodo = lerPeriodo(sp.de, sp.ate);
  const qs = `de=${periodo.de}&ate=${periodo.ate}`;
  const usaPeriodo = tipo !== "estoque";

  return (
    <main className="admin-wrap">
      <Nav loja={loja} usuario={usuario} atual="/gestao/relatorios" />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {RELATORIOS.map((x) => (
          <Link
            key={x.chave} href={`/gestao/relatorios?r=${x.chave}&${qs}`}
            className={`btn ${x.chave === tipo ? "" : "ghost"}`}
            style={{ height: 36, padding: "0 16px", fontSize: 13, display: "inline-flex", alignItems: "center" }}
          >
            {x.rotulo}
          </Link>
        ))}
      </div>

      <div className="linha-form" style={{ marginBottom: 18 }}>
        {usaPeriodo && (
          <form method="get" className="linha-form">
            <input type="hidden" name="r" value={tipo} />
            <label className="rotulo">
              De
              <input className="field" type="date" name="de" defaultValue={periodo.de} />
            </label>
            <label className="rotulo">
              Até
              <input className="field" type="date" name="ate" defaultValue={periodo.ate} />
            </label>
            <button className="btn ghost" type="submit" style={{ height: 40 }}>Aplicar</button>
          </form>
        )}
        <a
          className="btn ghost" href={`/gestao/relatorios/csv?r=${tipo}&${qs}`}
          style={{ height: 40, display: "inline-flex", alignItems: "center", marginLeft: "auto" }}
        >
          Baixar planilha (CSV)
        </a>
      </div>
      {usaPeriodo && <p className="sub" style={{ marginBottom: 14 }}>Período: {dia(periodo.de)} a {dia(periodo.ate)}</p>}

      {tipo === "estoque" && <Estoque />}
      {tipo === "entradas" && <Entradas de={periodo} />}
      {tipo === "saidas" && <Saidas de={periodo} />}
      {tipo === "perdas" && <Perdas de={periodo} />}
    </main>
  );
}

async function Estoque() {
  const { linhas, total } = await relatorioEstoque();
  return (
    <>
      <div className="stats">
        <Cartao rotulo="Produtos ativos" valor={String(total.produtos)} />
        <Cartao rotulo="Unidades em estoque" valor={String(total.unidades)} />
        <Cartao rotulo="Valor a custo" valor={reais(total.valorCustoCents)} />
        <Cartao rotulo="Valor a preço de venda" valor={reais(total.valorVendaCents)} />
        <Cartao rotulo="Para comprar" valor={String(total.paraComprar)} nota="no mínimo ou zerados" alerta={total.paraComprar > 0} />
      </div>
      <h2 className="section-title">Posição do estoque agora ({linhas.length})</h2>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Produto</th><th>Código de barras</th><th>Estoque</th><th>Mínimo</th><th>Custo</th><th>Preço</th><th>Valor a custo</th></tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id}>
                <td><Link href={`/gestao/produtos/${l.id}`}>{l.nome}</Link></td>
                <td>{l.ean ?? "—"}</td>
                <td><span className={`chip ${l.situacao === "Zerado" ? "err" : l.situacao === "No mínimo" ? "at" : "ok"}`}>{l.estoque}</span></td>
                <td>{l.minimo}</td>
                <td>{reais(l.custoCents)}</td>
                <td>{l.precoCents === null ? "sem preço" : reais(l.precoCents)}</td>
                <td>{reais(l.valorCustoCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function Entradas({ de }: { de: ReturnType<typeof lerPeriodo> }) {
  const { linhas, total } = await relatorioEntradas(de);
  return (
    <>
      <div className="stats">
        <Cartao rotulo="Entradas" valor={String(total.entradas)} nota="notas e lançamentos manuais" />
        <Cartao rotulo="Unidades que entraram" valor={String(total.unidades)} />
        <Cartao rotulo="Valor a custo" valor={reais(total.valorCents)} />
      </div>
      <h2 className="section-title">Itens que entraram ({linhas.length})</h2>
      {linhas.length === 0 ? <p className="sub">Nenhuma entrada no período.</p> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Quando</th><th>Origem</th><th>Fornecedor / nota</th><th>Produto</th><th>Qtd</th><th>Custo unit.</th><th>Total</th><th>Quem</th></tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap" }}>{dataHora(l.quando)}</td>
                  <td>{l.origem}</td>
                  <td>{l.fornecedor ? `${l.fornecedor}${l.nota ? ` · NF ${l.nota}` : ""}` : "—"}</td>
                  <td>{l.produto}</td>
                  <td>{l.quantidade}</td>
                  <td>{reais(l.custoUnitCents)}</td>
                  <td>{reais(l.totalCents)}</td>
                  <td>{l.quem || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Saidas({ de }: { de: ReturnType<typeof lerPeriodo> }) {
  const { linhas, total } = await relatorioSaidas(de);
  return (
    <>
      <div className="stats">
        <Cartao rotulo="Vendas" valor={String(total.vendas)} nota={total.simuladas ? `${total.simuladas} com pagamento simulado` : undefined} />
        <Cartao rotulo="Unidades vendidas" valor={String(total.unidades)} />
        <Cartao rotulo="Total vendido" valor={reais(total.receitaCents)} />
        <Cartao rotulo="Valor médio por venda" valor={reais(total.ticketMedioCents)} />
      </div>
      <h2 className="section-title">Vendas por produto ({linhas.length})</h2>
      {linhas.length === 0 ? <p className="sub">Nenhuma venda no período.</p> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Produto</th><th>Código de barras</th><th>Unidades</th><th>Total vendido</th></tr></thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i}>
                  <td>{l.produto}</td>
                  <td>{l.ean ?? "—"}</td>
                  <td>{l.quantidade}</td>
                  <td>{reais(l.receitaCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Perdas({ de }: { de: ReturnType<typeof lerPeriodo> }) {
  const { linhas, total } = await relatorioPerdas(de);
  const sinal = (n: number) => (n > 0 ? `+${n}` : String(n));
  return (
    <>
      <div className="stats">
        <Cartao rotulo="Perdas lançadas" valor={`${total.perdasUnidades} un.`} nota={`${reais(total.perdasValorCents)} a custo`} alerta={total.perdasUnidades > 0} />
        <Cartao
          rotulo="Ajustes de inventário" valor={`${sinal(total.ajustesUnidades)} un.`}
          nota={`${total.ajustesValorCents < 0 ? "−" : ""}${reais(Math.abs(total.ajustesValorCents))} a custo`}
          alerta={total.ajustesUnidades < 0}
        />
      </div>
      <p className="sub" style={{ marginTop: 10 }}>
        Ajuste negativo é produto que o sistema esperava e não estava na prateleira na contagem. O valor usa o custo
        atual de cada produto.
      </p>
      <h2 className="section-title">Lançamentos ({linhas.length})</h2>
      {linhas.length === 0 ? <p className="sub">Nenhuma perda ou ajuste no período.</p> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Quando</th><th>Tipo</th><th>Produto</th><th>Qtd</th><th>Valor a custo</th><th>Motivo</th><th>Quem</th></tr></thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap" }}>{dataHora(l.quando)}</td>
                  <td>{l.tipo}</td>
                  <td>{l.produto}</td>
                  <td style={{ color: l.quantidade < 0 ? "var(--erro)" : "var(--ok)" }}>{sinal(l.quantidade)}</td>
                  <td>{l.valorCents < 0 ? "−" : ""}{reais(Math.abs(l.valorCents))}</td>
                  <td>{l.motivo || "—"}</td>
                  <td>{l.quem || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
