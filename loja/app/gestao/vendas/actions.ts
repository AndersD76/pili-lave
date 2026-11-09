"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirLojista } from "@/lib/sessao";
import { cancelarVenda } from "@/lib/vendas";

const BASE = "/gestao/vendas";

/** Cancelar venda é sensível (desfaz dinheiro e estoque) — só o lojista. */
export async function cancelarVendaAction(formData: FormData) {
  const { usuario } = await exigirLojista();
  const vendaId = Number(formData.get("vendaId"));
  const motivo = String(formData.get("motivo") ?? "");
  if (!vendaId) redirect(`${BASE}?erro=${encodeURIComponent("Venda inválida.")}`);

  const r = await cancelarVenda(usuario, vendaId, motivo);
  if (!r.ok) redirect(`${BASE}?erro=${encodeURIComponent(r.erro)}`);

  revalidatePath(BASE);
  redirect(`${BASE}?ok=cancelada`);
}
