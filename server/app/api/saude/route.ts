import { NextResponse } from "next/server";
import { verificarEAlertar } from "@/lib/saude";

/**
 * Saúde da máquina para o app: diz se dá para lavar agora e, quando não dá,
 * a mensagem que o cliente deve ver. Aberto (sem login): a tela precisa
 * avisar antes mesmo de o cliente tentar pagar.
 */
export async function GET() {
  const d = await verificarEAlertar();
  return NextResponse.json(
    {
      disponivel: d.disponivel,
      estado: d.estado,               // LIVRE | LAVANDO | PARADA
      liberaEmSeg: d.liberaEmSeg,     // quanto falta, quando está lavando
      naFila: d.naFila,               // quantos já pagaram e esperam a vez
      motivo: d.motivo,
      cameraOffline: d.problemas.includes("CAMERA_OFFLINE"),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
