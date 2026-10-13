"use client";

/** Botão de imprimir a página (a lista de compras sai limpa: ver o
 *  @media print em globals.css). */
export function Imprimir() {
  return (
    <button className="btn ghost" type="button" onClick={() => window.print()} style={{ height: 40 }}>
      Imprimir
    </button>
  );
}
