"use client";

import { useRef } from "react";

/**
 * Código de barras do cadastro. Trocar não é como trocar o nome: é por
 * ele que a próxima entrada por nota fiscal reconhece o produto — mudar
 * (ou apagar) faz a próxima nota tratar como item novo (ou ficar sem
 * casar nenhum produto), então avisa antes de aceitar a mudança.
 */
export function CampoEan({ valorAtual, travado }: { valorAtual: string; travado?: boolean }) {
  const ultimoValido = useRef(valorAtual);

  function conferir(e: React.ChangeEvent<HTMLInputElement>) {
    if (travado) return;
    const novo = e.target.value;
    if (
      ultimoValido.current &&
      novo !== ultimoValido.current &&
      !window.confirm("Mudar o código de barras pode fazer a próxima nota fiscal desse fornecedor não reconhecer este produto. Continuar?")
    ) {
      e.target.value = ultimoValido.current;
      return;
    }
    ultimoValido.current = novo;
  }

  return (
    <input
      className="field" name="ean" defaultValue={valorAtual} inputMode="numeric" maxLength={14}
      onBlur={conferir} readOnly={travado} style={travado ? { opacity: 0.6 } : undefined}
    />
  );
}
