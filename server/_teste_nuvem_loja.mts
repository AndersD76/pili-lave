// Teste das rotas de nuvem da loja: chama os handlers das rotas direto (sem
// precisar do servidor no ar), contra o banco LOCAL. Cria e apaga os
// próprios dados. Rodar: npx tsx _teste_nuvem_loja.mts
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])
);
if (!/localhost|127\.0\.0\.1/.test(env.DATABASE_URL)) throw new Error("DATABASE_URL não é local — abortado");
Object.assign(process.env, env);

const { NextRequest } = await import("next/server");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const ROTAS: [RegExp, string][] = [
  [/^\/api\/loja\/rostos$/, "./app/api/loja/rostos/route.ts"],
  [/^\/api\/loja\/comandos$/, "./app/api/loja/comandos/route.ts"],
  [/^\/api\/loja\/comandos\/([^/]+)\/feito$/, "./app/api/loja/comandos/[id]/feito/route.ts"],
  [/^\/api\/loja\/alertas$/, "./app/api/loja/alertas/route.ts"],
  [/^\/api\/loja\/vendas\/sincronizar$/, "./app/api/loja/vendas/sincronizar/route.ts"],
  [/^\/api\/me\/foto$/, "./app/api/me/foto/route.ts"],
  [/^\/api\/dono\/lojas$/, "./app/api/dono/lojas/route.ts"],
  [/^\/api\/dono\/lojas\/([^/]+)\/abrir-porta$/, "./app/api/dono/lojas/[id]/abrir-porta/route.ts"],
  [/^\/api\/dono\/lojas\/([^/]+)\/bloqueios$/, "./app/api/dono/lojas/[id]/bloqueios/route.ts"],
  [/^\/api\/dono\/lojas\/([^/]+)\/alertas$/, "./app/api/dono/lojas/[id]/alertas/route.ts"],
  [/^\/api\/dono\/lojas\/([^/]+)\/indicadores$/, "./app/api/dono/lojas/[id]/indicadores/route.ts"],
  [/^\/api\/dono\/alertas\/([^/]+)$/, "./app/api/dono/alertas/[id]/route.ts"],
];

const BASE = "http://localhost:3000";
const prisma = new PrismaClient();
const secret = new TextEncoder().encode(env.JWT_SECRET);
const T = `t${Date.now()}`;
const KEY = `devkey-teste-${T}`;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

let falhas = 0;
function ok(cond: unknown, nome: string) {
  if (!cond) falhas++;
  console.log(`${cond ? "ok  " : "FALHOU"} ${nome}`);
}
const token = (id: string) =>
  new SignJWT({ phone: "x", role: "CLIENT" }).setProtectedHeader({ alg: "HS256" }).setSubject(id)
    .setIssuedAt().setExpirationTime("10m").sign(secret);

async function chamar(path: string, o: { method?: string; body?: unknown; key?: string; user?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (o.key) headers["x-device-key"] = o.key;
  if (o.user) headers.Authorization = `Bearer ${await token(o.user)}`;
  const method = o.method ?? (o.body ? "POST" : "GET");
  const url = new URL(BASE + path);
  const rota = ROTAS.find(([re]) => re.test(url.pathname));
  if (!rota) throw new Error(`rota não mapeada no teste: ${url.pathname}`);
  const handler = (await import(rota[1]))[method] as Handler;
  const r = await handler(
    new NextRequest(url, { method, headers, body: o.body ? JSON.stringify(o.body) : undefined }),
    { params: Promise.resolve({ id: rota[0].exec(url.pathname)?.[1] ?? "" }) }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

const ids = { users: [] as string[], loja: "" };
try {
  const novo = (n: number, nascimento: string) =>
    prisma.user.create({ data: { phone: `+55000${T}${n}`, name: `Teste ${n}`, nascimento: new Date(nascimento) } });
  const dono = await novo(1, "1980-01-01");
  const cliente = await novo(2, "2005-03-10");
  const estranho = await novo(3, "1970-01-01");
  ids.users = [dono.id, cliente.id, estranho.id];
  const loja = await prisma.loja.create({ data: { name: `Loja teste ${T}`, deviceKey: KEY, donoId: dono.id } });
  ids.loja = loja.id;
  const antes = new Date(Date.now() - 1000).toISOString();
  await prisma.fotoRosto.create({ data: { userId: cliente.id, jpeg: JPEG, bytes: JPEG.length, consentimentoEm: new Date() } });

  // ---- rostos
  ok((await chamar("/api/loja/rostos")).status === 401, "rostos sem chave = 401");
  let r = await chamar(`/api/loja/rostos?desde=${encodeURIComponent(antes)}`, { key: KEY });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meu = r.json?.clientes?.find((c: any) => c.userId === cliente.id);
  ok(r.status === 200 && meu && !meu.removido && meu.fotoBase64 === JPEG.toString("base64") && meu.codigoCliente === cliente.codigoCliente, "rostos traz a foto do cliente");
  r = await chamar(`/api/loja/rostos?desde=${encodeURIComponent(new Date(Date.now() + 60000).toISOString())}`, { key: KEY });
  ok(r.json?.clientes?.length === 0 && r.json?.proximo === null, "rostos desde o futuro = vazio");
  ok((await chamar("/api/loja/rostos?desde=abc", { key: KEY })).status === 400, "rostos desde inválido = 400");
  ok((await chamar("/api/me/foto", { method: "DELETE", user: cliente.id })).status === 200, "cliente tira a foto");
  r = await chamar(`/api/loja/rostos?desde=${encodeURIComponent(antes)}`, { key: KEY });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rem = r.json?.clientes?.find((c: any) => c.userId === cliente.id);
  ok(rem?.removido === true && rem.fotoBase64 === null, "rostos avisa a remoção");

  // ---- comandos / abertura remota / bloqueio
  ok((await chamar("/api/loja/comandos")).status === 401, "comandos sem chave = 401");
  ok((await chamar(`/api/dono/lojas/${loja.id}/abrir-porta`, { body: {}, user: estranho.id })).status === 404, "quem não é dono não abre a porta");
  const ab = await chamar(`/api/dono/lojas/${loja.id}/abrir-porta`, { body: { motivo: "entregador" }, user: dono.id });
  ok(ab.status === 201 && ab.json.situacao === "AGUARDANDO", "dono pede abertura");
  const ab2 = await chamar(`/api/dono/lojas/${loja.id}/abrir-porta`, { body: {}, user: dono.id });
  ok(ab2.json?.id === ab.json.id, "toque repetido não duplica o pedido");
  ok((await chamar(`/api/dono/lojas/${loja.id}/bloqueios`, { body: { codigoCliente: cliente.codigoCliente, motivo: "teste automático" }, user: dono.id })).status === 201, "dono bloqueia cliente");
  r = await chamar("/api/loja/comandos", { key: KEY });
  ok(r.json?.bloqueados?.includes(cliente.codigoCliente), "comandos lista o bloqueado");
  ok(r.json?.aberturasRemotas?.length === 1 && r.json.aberturasRemotas[0].id === ab.json.id && r.json.aberturasRemotas[0].pedidaPor === "Teste 1", "comandos lista a abertura");
  ok((await chamar(`/api/loja/comandos/${ab.json.id}/feito`, { method: "POST", key: `${KEY}x` })).status === 401, "feito com chave errada = 401");
  ok((await chamar(`/api/loja/comandos/${ab.json.id}/feito`, { method: "POST", key: KEY })).status === 200, "loja confirma a abertura");
  ok((await chamar(`/api/loja/comandos/${ab.json.id}/feito`, { method: "POST", key: KEY })).json?.jaConfirmado === true, "confirmar de novo é idempotente");
  r = await chamar("/api/loja/comandos", { key: KEY });
  ok(r.json?.aberturasRemotas?.length === 0, "abertura atendida some dos comandos");
  r = await chamar(`/api/dono/lojas/${loja.id}/abrir-porta`, { user: dono.id });
  ok(r.json?.aberturas?.[0]?.situacao === "ABERTA", "dono vê que a porta abriu");
  await prisma.lojaAberturaRemota.create({ data: { lojaId: loja.id, pedidaPorId: dono.id, pedidaEm: new Date(Date.now() - 10 * 60000) } });
  r = await chamar("/api/loja/comandos", { key: KEY });
  ok(r.json?.aberturasRemotas?.length === 0, "pedido velho (10 min) nunca chega na loja");

  // ---- alertas
  const alerta = {
    codigo: `alerta-${T}`, tipo: "INVASAO", titulo: "Invasão detectada", detalhe: "Porta forçada",
    imagens: [JPEG.toString("base64")], ocorridoEm: new Date().toISOString(), codigoCliente: cliente.codigoCliente,
  };
  ok((await chamar("/api/loja/alertas", { body: alerta })).status === 401, "alerta sem chave = 401");
  ok((await chamar("/api/loja/alertas", { body: { ...alerta, tipo: "OUTRO" }, key: KEY })).status === 400, "alerta com tipo inválido = 400");
  ok((await chamar("/api/loja/alertas", { body: { ...alerta, imagens: ["aGVsbG8="] }, key: KEY })).status === 400, "imagem que não é JPEG = 400");
  const a1 = await chamar("/api/loja/alertas", { body: alerta, key: KEY });
  ok(a1.status === 201, "loja manda alerta");
  const a2 = await chamar("/api/loja/alertas", { body: alerta, key: KEY });
  ok(a2.status === 200 && a2.json.jaRecebido && a2.json.id === a1.json.id, "reenvio do alerta não duplica");
  await chamar("/api/loja/alertas", { body: { ...alerta, codigo: `alerta2-${T}`, tipo: "ESTOQUE_MINIMO", titulo: "Estoque baixo", imagens: [], codigoCliente: null, ocorridoEm: new Date(Date.now() + 1000).toISOString() }, key: KEY });
  r = await chamar(`/api/dono/lojas/${loja.id}/alertas`, { user: dono.id });
  ok(r.json?.naoLidos === 2 && r.json.alertas[0].tipo === "INVASAO" && r.json.alertas[0].imagens === 1 && r.json.alertas[0].clienteBloqueado === true, "dono vê os alertas, invasão primeiro");
  ok((await chamar(`/api/dono/lojas/${loja.id}/alertas`, { user: estranho.id })).status === 404, "estranho não vê alertas");
  ok((await chamar(`/api/dono/alertas/${a1.json.id}`, { user: estranho.id })).status === 404, "estranho não vê imagens");
  r = await chamar(`/api/dono/alertas/${a1.json.id}`, { user: dono.id });
  ok(r.json?.imagens?.[0] === JPEG.toString("base64"), "dono vê a imagem do alerta");
  ok((await chamar(`/api/dono/alertas/${a1.json.id}`, { method: "POST", user: dono.id })).status === 200, "dono marca como lido");
  r = await chamar("/api/dono/lojas", { user: dono.id });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ok(r.json?.lojas?.find((l: any) => l.id === loja.id)?.alertasNaoLidos === 1, "contador de não lidos na lista de lojas");
  await chamar(`/api/dono/lojas/${loja.id}/alertas`, { method: "POST", user: dono.id });
  r = await chamar(`/api/dono/lojas/${loja.id}/alertas`, { user: dono.id });
  ok(r.json?.naoLidos === 0, "marcar todos como lidos");

  // ---- indicadores
  const agora = new Date();
  const venda = (n: number, forma: string, totalCents: number) => ({
    codigo: `venda-${T}-${n}`, totalCents, forma, criadaEm: agora.toISOString(),
    itens: [{ nome: "Coca teste", ean: `789${T}`, quantidade: n, precoUnitCents: Math.round(totalCents / n) }],
  });
  r = await chamar("/api/loja/vendas/sincronizar", {
    key: KEY, body: { vendas: [venda(1, "CARTEIRA", 500), venda(2, "MAQUININHA", 1000), venda(3, "SIMULADO", 9999), venda(4, "CARTEIRA", 2000)] },
  });
  ok(r.json?.sincronizados?.length === 4, "vendas sincronizadas");
  await prisma.walletTx.createMany({
    data: [
      { userId: cliente.id, amountCents: -500, kind: "LOJA", refId: `venda-${T}-1` },
      { userId: cliente.id, amountCents: -2000, kind: "LOJA", refId: `venda-${T}-4` },
      { userId: cliente.id, amountCents: 2000, kind: "REFUND", refId: `estorno:venda-${T}-4` },
    ],
  });
  r = await chamar(`/api/dono/lojas/${loja.id}/indicadores`, { user: dono.id });
  const i = r.json;
  ok(r.status === 200 && i.faturamentoCents === 1500 && i.vendas === 2 && i.ticketMedioCents === 750, "faturamento ignora simulada e estornada");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ok(i.faixaEtaria?.find((f: any) => f.faixa === "18 a 24")?.totalCents === 500 && i.faixaEtaria?.find((f: any) => f.faixa === "Sem identificação")?.totalCents === 1000, "faixa etária: carteira identificada, cartão anônimo");
  ok(i.maisVendidos?.[0]?.quantidade === 3 && i.porForma?.length === 2 && i.porHora?.length === 24 && i.porDiaSemana?.length === 7 && i.porDia?.length === 1, "mais vendidos, forma, hora, dia da semana");
  ok((await chamar(`/api/dono/lojas/${loja.id}/indicadores?de=2026-01-01&ate=2026-01-31`, { user: dono.id })).json?.vendas === 0, "período sem vendas = zero");
  ok((await chamar(`/api/dono/lojas/${loja.id}/indicadores?de=xx`, { user: dono.id })).status === 400, "período inválido = 400");
  ok((await chamar(`/api/dono/lojas/${loja.id}/indicadores`, { user: estranho.id })).status === 404, "estranho não vê indicadores");
} finally {
  if (ids.loja) {
    await prisma.lojaAlerta.deleteMany({ where: { lojaId: ids.loja } });
    await prisma.lojaAberturaRemota.deleteMany({ where: { lojaId: ids.loja } });
    await prisma.lojaBloqueio.deleteMany({ where: { lojaId: ids.loja } });
    await prisma.vendaLoja.deleteMany({ where: { lojaId: ids.loja } });
    await prisma.event.deleteMany({ where: { payload: { path: ["lojaId"], equals: ids.loja } } });
    await prisma.loja.delete({ where: { id: ids.loja } });
  }
  if (ids.users.length) {
    await prisma.event.deleteMany({ where: { OR: ids.users.map((u) => ({ payload: { path: ["userId"], equals: u } })) } });
    await prisma.walletTx.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.rostoRemovido.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.fotoRosto.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  }
  await prisma.$disconnect();
  console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo, dados de teste apagados.");
  process.exitCode = falhas ? 1 : 0;
}
