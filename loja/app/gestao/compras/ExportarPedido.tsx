"use client";

import { useState } from "react";

type LinhaPedido = { nome: string; quantidade: number; unidade: string };

/** Monta um texto simples com o pedido e oferece copiar, abrir no WhatsApp
 *  ou mandar por e-mail — tudo a partir do mesmo texto. */
export function ExportarPedido({ titulo, linhas }: { titulo: string; linhas: LinhaPedido[] }) {
  const [copiado, setCopiado] = useState(false);
  if (linhas.length === 0) return null;

  const texto = [
    `Pedido — ${titulo}`,
    "",
    ...linhas.map((l) => `• ${l.nome} — ${l.quantidade} ${l.unidade}`),
  ].join("\n");

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // clipboard pode falhar sem HTTPS/permissão; os links abaixo seguem funcionando
    }
  }

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
      <button type="button" className="btn ghost" onClick={copiar} style={{ height: 36 }}>
        {copiado ? "Copiado!" : "Copiar pedido"}
      </button>
      <a
        className="btn ghost" style={{ height: 36, display: "inline-flex", alignItems: "center" }}
        href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer"
      >
        Enviar por WhatsApp
      </a>
      <a
        className="btn ghost" style={{ height: 36, display: "inline-flex", alignItems: "center" }}
        href={`mailto:?subject=${encodeURIComponent(`Pedido — ${titulo}`)}&body=${encodeURIComponent(texto)}`}
      >
        Enviar por e-mail
      </a>
    </div>
  );
}
