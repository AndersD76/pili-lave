import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/admin";
import { indicadoresDaLoja, periodoDaUrl } from "@/lib/lojaIndicadores";
import { AdminNav } from "../../nav";

export const dynamic = "force-dynamic";

function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const FORMA: Record<string, string> = { CARTEIRA: "Carteira do app", MAQUININHA: "Cartão (maquininha)" };

/** Barra horizontal proporcional — dá a noção de tamanho sem biblioteca de gráfico. */
function Barra({ valor, maximo }: { valor: number; maximo: number }) {
  return (
    <div style={{ background: "var(--linha, #e5e7eb)", borderRadius: 4, height: 8, minWidth: 80 }}>
      <div
        style={{
          width: `${maximo > 0 ? Math.round((valor / maximo) * 100) : 0}%`, height: 8, borderRadius: 4,
          background: "var(--azul, #2563eb)",
        }}
      />
    </div>
  );
}

function Tabela({ titulo, linhas }: { titulo: string; linhas: { rotulo: string; vendas: number; totalCents: number }[] }) {
  const maximo = Math.max(0, ...linhas.map((l) => l.totalCents));
  return (
    <div className="card" style={{ flex: "1 1 320px" }}>
      <b>{titulo}</b>
      {linhas.length === 0 ? (
        <p style={{ color: "var(--aco-d)", fontSize: 13, marginTop: 8 }}>Sem vendas no período.</p>
      ) : (
        <table className="tbl" style={{ marginTop: 8, width: "100%" }}>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.rotulo}>
                <td>{l.rotulo}</td>
                <td style={{ width: "35%" }}><Barra valor={l.totalCents} maximo={maximo} /></td>
                <td style={{ textAlign: "right" }}>{l.vendas}</td>
                <td style={{ textAlign: "right" }}>{money(l.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default async function AdminLojaIndicadores({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  await requireAdminPage();
  const { id } = await params;
  const sp = await searchParams;
  const loja = await prisma.loja.findUnique({ where: { id }, include: { dono: { select: { name: true } } } });
  if (!loja) notFound();

  const pedido = periodoDaUrl({ get: (n) => (n === "de" ? sp.de : n === "ate" ? sp.ate : null) ?? null });
  const periodo = pedido ?? periodoDaUrl({ get: () => null })!;
  const [ind, alertas] = await Promise.all([
    indicadoresDaLoja(id, periodo),
    prisma.lojaAlerta.findMany({ where: { lojaId: id }, orderBy: { ocorridoEm: "desc" }, take: 15 }),
  ]);

  return (
    <main className="admin-wrap">
      <AdminNav />
      <p style={{ fontSize: 13 }}><Link href="/admin/lojas">← Lojas</Link></p>
      <h2 className="section-title" style={{ marginTop: 6 }}>{loja.name} — indicadores</h2>
      <p style={{ color: "var(--aco-d)", fontSize: 14, marginBottom: 14 }}>
        {[loja.address, `${loja.city}/${loja.state}`].filter(Boolean).join(" · ")} · Dono: {loja.dono?.name ?? "não definido"}.
        Os números vêm das vendas que o computador da loja sincroniza (venda de teste e venda estornada não contam).
        A faixa etária só existe para compras pagas pela carteira do app; cartão entra como “Sem identificação”.
      </p>

      <form method="get" style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, fontWeight: 600 }}>
          De
          <input className="field" type="date" name="de" defaultValue={periodo.de} style={{ display: "block", height: 36 }} />
        </label>
        <label style={{ fontSize: 12, fontWeight: 600 }}>
          Até
          <input className="field" type="date" name="ate" defaultValue={periodo.ate} style={{ display: "block", height: 36 }} />
        </label>
        <button className="btn ghost" type="submit" style={{ height: 36 }}>Aplicar</button>
        {!pedido && <span style={{ color: "var(--erro, #e05555)", fontSize: 13 }}>Período inválido — mostrando os últimos 30 dias.</span>}
      </form>

      <div className="stats">
        <div className="stat"><div className="lab">Faturamento</div><div className="val">{money(ind.faturamentoCents)}</div><div className="sub">no período</div></div>
        <div className="stat"><div className="lab">Vendas</div><div className="val">{ind.vendas}</div><div className="sub">compras fechadas</div></div>
        <div className="stat"><div className="lab">Ticket médio</div><div className="val">{money(ind.ticketMedioCents)}</div><div className="sub">por compra</div></div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14 }}>
        <div className="card" style={{ flex: "1 1 320px" }}>
          <b>Itens mais vendidos</b>
          {ind.maisVendidos.length === 0 ? (
            <p style={{ color: "var(--aco-d)", fontSize: 13, marginTop: 8 }}>Sem vendas no período.</p>
          ) : (
            <table className="tbl" style={{ marginTop: 8, width: "100%" }}>
              <tbody>
                {ind.maisVendidos.map((i) => (
                  <tr key={i.ean ?? i.nome}>
                    <td>{i.nome}</td>
                    <td style={{ textAlign: "right" }}>{i.quantidade} un</td>
                    <td style={{ textAlign: "right" }}>{money(i.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Tabela titulo="Forma de pagamento" linhas={ind.porForma.map((f) => ({ rotulo: FORMA[f.forma] ?? f.forma, ...f }))} />
        <Tabela titulo="Faixa etária" linhas={ind.faixaEtaria.map((f) => ({ rotulo: f.faixa, ...f }))} />
        <Tabela titulo="Dia da semana" linhas={ind.porDiaSemana.filter((d) => d.vendas > 0).map((d) => ({ rotulo: d.dia, ...d }))} />
        <Tabela titulo="Horário" linhas={ind.porHora.filter((h) => h.vendas > 0).map((h) => ({ rotulo: `${h.hora}h`, ...h }))} />
        <Tabela
          titulo="Por dia"
          linhas={ind.porDia.map((d) => ({ rotulo: d.dia.split("-").reverse().slice(0, 2).join("/"), ...d }))}
        />
      </div>

      <h3 className="section-title">Últimos avisos da loja</h3>
      {alertas.length === 0 ? (
        <p style={{ color: "var(--aco-d)", fontSize: 14 }}>Nenhum aviso recebido.</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>Quando</th><th>Aviso</th><th>Detalhe</th><th>Dono viu?</th></tr></thead>
          <tbody>
            {alertas.map((a) => (
              <tr key={a.id}>
                <td>{a.ocorridoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                <td>{a.titulo}</td>
                <td>{a.detalhe}</td>
                <td>{a.lidoEm ? "Sim" : "Não"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
