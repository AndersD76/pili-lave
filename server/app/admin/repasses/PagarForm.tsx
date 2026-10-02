"use client";

import { useActionState } from "react";
import { pagar } from "./actions";

/**
 * Botão de pagar com confirmação: o dinheiro sai da conta Asaas na hora,
 * então o admin vê nome, chave e valor antes de confirmar.
 */
export function PagarForm({
  userId,
  nome,
  chave,
  aPagarCents,
  bloqueado,
}: {
  userId: string;
  nome: string;
  chave: string | null;
  aPagarCents: number;
  bloqueado: string | null;
}) {
  const [state, formAction, pending] = useActionState(pagar, null);

  if (!chave)
    return <span style={{ color: "var(--atencao)", fontSize: 12 }}>Sem chave PIX — peça para cadastrar no Perfil do app</span>;
  if (aPagarCents <= 0 && !state) return <span style={{ color: "var(--aco-d)" }}>—</span>;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const valor = String(new FormData(e.currentTarget).get("valor") || "");
        const ok = window.confirm(
          `Enviar R$ ${valor} via PIX para ${nome}?\n\nChave: ${chave}\n\nO dinheiro sai da conta Asaas na hora.`
        );
        if (!ok) e.preventDefault();
      }}
      style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
    >
      <input type="hidden" name="userId" value={userId} />
      {aPagarCents > 0 && (
        <>
          <input
            className="field"
            name="valor"
            inputMode="decimal"
            defaultValue={(aPagarCents / 100).toFixed(2).replace(".", ",")}
            style={{ width: 96, height: 32, fontSize: 13, padding: "0 8px" }}
            disabled={!!bloqueado}
          />
          <button
            className="btn ghost"
            type="submit"
            disabled={pending || !!bloqueado}
            title={bloqueado ?? undefined}
            style={{ height: 32, padding: "0 10px", fontSize: 12 }}
          >
            {pending ? "Enviando..." : "Pagar via PIX"}
          </button>
        </>
      )}
      {state && "error" in state && (
        <span style={{ color: "var(--erro)", fontSize: 12, width: "100%" }}>{state.error}</span>
      )}
      {state && "ok" in state && (
        <span style={{ color: "var(--ok)", fontSize: 12, width: "100%" }}>{state.ok}</span>
      )}
    </form>
  );
}
