import { NextResponse } from "next/server";
import { listaDeCompras } from "@/lib/compras";
import { pode } from "@/lib/permissoes";
import { usuarioDaSessao } from "@/lib/sessao";

const dinheiro = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/** Lista de compras em planilha — mesmo formato dos relatórios (ponto e
 *  vírgula e marca de UTF-8, pro Excel em português abrir direto). */
export async function GET() {
  const usuario = await usuarioDaSessao();
  if (!usuario || !pode(usuario, "COMPRAS")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const { linhas, total } = await listaDeCompras();
  const celula = (v: string | number) => {
    const s = String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const tabela: (string | number)[][] = [
    ["Produto", "Código de barras", "Comprar", "Unidade", "Em estoque", "Mínimo", "Último custo", "Estimado", "Último fornecedor"],
    ...linhas.map((l) => [l.nome, l.ean ?? "", l.quantidade, l.unidade, l.estoque, l.minimo, dinheiro(l.custoCents), dinheiro(l.totalCents), l.fornecedor]),
    ["TOTAL", "", total.unidades, "", "", "", "", dinheiro(total.valorCents), ""],
  ];
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return new NextResponse("﻿" + tabela.map((l) => l.map(celula).join(";")).join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lista-de-compras-${hoje}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
