import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { conferirCarrinho, finalizarVenda, MAX_ITENS, MAX_POR_ITEM } from "@/lib/caixa";
import { lerConfig, lojaConfigurada, NUVEM_URL } from "@/lib/config";
import { debitarCarteira, estornarCarteira } from "@/lib/nuvem";

const Body = z.object({
  token: z.string().min(10),
  itens: z
    .array(z.object({ produtoId: z.string().min(1), quantidade: z.number().int().min(1).max(MAX_POR_ITEM) }))
    .min(1)
    .max(MAX_ITENS),
  visitaId: z.string().min(1).nullish(),
});

const MENSAGEM: Record<string, string> = {
  SALDO_INSUFICIENTE: "Saldo insuficiente na carteira do cliente.",
  EXPIRADO: "O QR venceu. Peça pro cliente abrir a tela de pagamento de novo e escaneie o código novo.",
  SEM_CONEXAO: "Sem internet no momento — não dá pra pagar pela carteira. Use o cartão.",
};

/**
 * Confirma o pagamento pela carteira: debita na nuvem primeiro (é lá que
 * mora o saldo) e só então grava a venda local com o MESMO código, pra
 * ficar rastreável qual lançamento da carteira corresponde a qual venda. Se
 * a gravação local falhar depois do débito ter ido, reenviar esta mesma
 * venda não cobra de novo — a nuvem já reconhece o código.
 */
export async function POST(req: NextRequest) {
  if (!(await lojaConfigurada())) return NextResponse.json({ ok: false, erro: "Loja não cadastrada" }, { status: 503 });
  const deviceKey = await lerConfig("deviceKey");
  if (!deviceKey) return NextResponse.json({ ok: false, erro: "Loja não cadastrada" }, { status: 503 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: "Compra inválida." }, { status: 400 });

  const carrinho = await conferirCarrinho(parsed.data.itens);
  if (!carrinho.ok) return NextResponse.json({ ok: false, erro: carrinho.erro }, { status: 409 });

  const vendaCodigo = randomUUID();
  const debito = await debitarCarteira(NUVEM_URL, deviceKey, {
    token: parsed.data.token, totalCents: carrinho.totalCents, vendaCodigo, itens: parsed.data.itens.length,
  });
  if (debito.situacao !== "OK")
    return NextResponse.json(
      { ok: false, erro: MENSAGEM[debito.situacao] ?? ("mensagem" in debito ? debito.mensagem : "Não foi possível cobrar.") },
      { status: debito.situacao === "SALDO_INSUFICIENTE" ? 402 : 409 }
    );

  const r = await finalizarVenda(parsed.data.itens, "CARTEIRA", vendaCodigo, parsed.data.visitaId);
  if (!r.ok) {
    // o débito já foi feito na nuvem — devolve, pro cliente não pagar por nada
    const estornado = await estornarCarteira(NUVEM_URL, deviceKey, vendaCodigo);
    return NextResponse.json(
      { ok: false, erro: estornado ? `${r.erro} O valor já foi devolvido para a carteira.` : `${r.erro} Avise o dono: pode ser preciso estornar manualmente (venda ${vendaCodigo}).` },
      { status: 409 }
    );
  }
  return NextResponse.json(r, { status: 201 });
}
