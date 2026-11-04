"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin";
import { resolverContadores } from "@/lib/contadores";

/** Acerto: o admin escolhe qual lista vale quando o display e a nuvem diferem (ver lib/contadores.ts). */
export async function escolherListaContadores(formData: FormData) {
  if (!(await isAdmin())) return;
  const machineId = String(formData.get("machineId") || "");
  const fonte = formData.get("fonte") === "display" ? "display" : formData.get("fonte") === "nuvem" ? "nuvem" : null;
  if (!machineId || !fonte) return;
  await resolverContadores(machineId, fonte, null);
  revalidatePath("/admin/lavagens");
  revalidatePath("/admin/maquinas");
}
