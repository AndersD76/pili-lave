import { NextResponse } from "next/server";
import { asaasConfigurado, asaasSandbox } from "@/lib/asaas";

/**
 * Situação do pagamento, para o app saber ANTES de o cliente tentar
 * recarregar. Sem a chave do Asaas a tela de recarga explica em vez de
 * mostrar um erro técnico no meio do caminho.
 */
export async function GET() {
  return NextResponse.json(
    {
      disponivel: asaasConfigurado(),
      // sandbox = ambiente de teste: a cobrança é simulada, não cobra de verdade
      teste: asaasConfigurado() && asaasSandbox(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
