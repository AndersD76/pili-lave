import { NextRequest, NextResponse } from "next/server";
import { pode } from "@/lib/permissoes";
import {
  lerPeriodo, RELATORIOS, relatorioEntradas, relatorioEstoque, relatorioPerdas, relatorioSaidas, type TipoRelatorio,
} from "@/lib/relatorios";
import { usuarioDaSessao } from "@/lib/sessao";

/** "12,50" — número com vírgula, sem "R$", pra planilha somar. */
const dinheiro = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const quando = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** Planilha no formato que o Excel em português abre direto: separador
 *  ponto e vírgula, e a marca de UTF-8 no início pra acentuação sair certa. */
function csv(linhas: (string | number)[][]): string {
  const celula = (v: string | number) => {
    const s = String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + linhas.map((l) => l.map(celula).join(";")).join("\r\n") + "\r\n";
}

/** Download do relatório em CSV — mesmas contas da tela (lib/relatorios.ts). */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDaSessao();
  if (!usuario || !pode(usuario, "RELATORIOS")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const r = sp.get("r");
  const tipo: TipoRelatorio = RELATORIOS.some((x) => x.chave === r) ? (r as TipoRelatorio) : "estoque";
  const p = lerPeriodo(sp.get("de") ?? undefined, sp.get("ate") ?? undefined);

  let linhas: (string | number)[][];
  let nome = `${tipo}-${p.de}-a-${p.ate}`;
  if (tipo === "estoque") {
    const d = await relatorioEstoque();
    nome = `estoque-${p.ate}`;
    linhas = [
      ["Produto", "Código de barras", "Estoque", "Mínimo", "Situação", "Custo", "Preço de venda", "Valor a custo", "Valor a preço de venda"],
      ...d.linhas.map((l) => [l.nome, l.ean ?? "", l.estoque, l.minimo, l.situacao, dinheiro(l.custoCents), l.precoCents === null ? "" : dinheiro(l.precoCents), dinheiro(l.valorCustoCents), dinheiro(l.valorVendaCents)]),
    ];
  } else if (tipo === "entradas") {
    const d = await relatorioEntradas(p);
    linhas = [
      ["Quando", "Origem", "Fornecedor", "Nota", "Produto", "Quantidade", "Custo unitário", "Total", "Quem"],
      ...d.linhas.map((l) => [quando(l.quando), l.origem, l.fornecedor, l.nota, l.produto, l.quantidade, dinheiro(l.custoUnitCents), dinheiro(l.totalCents), l.quem]),
    ];
  } else if (tipo === "saidas") {
    const d = await relatorioSaidas(p);
    linhas = [
      ["Produto", "Código de barras", "Unidades vendidas", "Total vendido"],
      ...d.linhas.map((l) => [l.produto, l.ean ?? "", l.quantidade, dinheiro(l.receitaCents)]),
    ];
  } else {
    const d = await relatorioPerdas(p);
    linhas = [
      ["Quando", "Tipo", "Produto", "Quantidade", "Valor a custo", "Motivo", "Quem"],
      ...d.linhas.map((l) => [quando(l.quando), l.tipo, l.produto, l.quantidade, dinheiro(l.valorCents), l.motivo, l.quem]),
    ];
  }

  return new NextResponse(csv(linhas), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
