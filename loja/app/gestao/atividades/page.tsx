import Link from "next/link";
import { ROTULO_ACAO } from "@/lib/atividade";
import { prisma } from "@/lib/prisma";
import { exigirLojista } from "@/lib/sessao";
import { Nav } from "../nav";

export const dynamic = "force-dynamic";

const LIMITE = 300;

function dataHora(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Registro de atividades — só o lojista vê. Tudo o que foi feito na gestão,
 * por quem e quando. Não tem edição nem exclusão: é a trilha de auditoria.
 */
export default async function Atividades({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  const { loja, usuario } = await exigirLojista();
  const { u } = await searchParams;
  const [usuarios, atividades] = await Promise.all([
    prisma.usuario.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true, ativo: true } }),
    prisma.atividade.findMany({
      where: u ? { usuarioId: u } : {},
      orderBy: { criadoEm: "desc" },
      take: LIMITE,
    }),
  ]);

  return (
    <main className="admin-wrap">
      <Nav loja={loja} usuario={usuario} atual="/gestao/atividades" />

      <form method="get" className="linha-form">
        <label className="rotulo" style={{ minWidth: 240 }}>
          Mostrar atividades de
          <select className="field" name="u" defaultValue={u ?? ""}>
            <option value="">Todos</option>
            {usuarios.map((x) => (
              <option key={x.id} value={x.id}>{x.nome}{x.ativo ? "" : " (desativado)"}</option>
            ))}
          </select>
        </label>
        <button className="btn ghost" type="submit" style={{ height: 40 }}>Filtrar</button>
      </form>

      <h2 className="section-title">Atividades (últimas {atividades.length})</h2>
      {atividades.length === 0 ? (
        <p className="sub">Nenhuma atividade registrada.</p>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhe</th></tr></thead>
            <tbody>
              {atividades.map((a) => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{dataHora(a.criadoEm)}</td>
                  <td>{a.usuarioNome}</td>
                  <td>{ROTULO_ACAO[a.acao] ?? a.acao}</td>
                  <td>
                    {a.produtoId ? <Link href={`/gestao/produtos/${a.produtoId}`}>{a.detalhe}</Link> : a.detalhe}
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
