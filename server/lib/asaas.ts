import { prisma } from "./prisma";

const BASE = process.env.ASAAS_BASE_URL ?? "https://api-sandbox.asaas.com/v3";

/** A recarga só funciona com a chave do Asaas configurada no ambiente. */
export function asaasConfigurado(): boolean {
  return !!process.env.ASAAS_API_KEY?.trim();
}

/** Sandbox é ambiente de teste: dinheiro não é real. */
export function asaasSandbox(): boolean {
  return BASE.includes("sandbox");
}

async function asaas(method: string, path: string, body?: unknown) {
  /* Sem chave, o Asaas responde 401 e o cliente via "Asaas 401" na tela.
   * Falha cedo, com um texto que diz o que fazer. */
  if (!asaasConfigurado())
    throw new Error("Pagamento indisponível no momento (chave do Asaas não configurada).");

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      access_token: process.env.ASAAS_API_KEY ?? "",
      "User-Agent": "PiliLaveServer/1.0",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`Asaas ${method} ${path} -> ${res.status}`, JSON.stringify(json)?.slice(0, 500));
    throw new Error(json?.errors?.[0]?.description ?? `Asaas ${res.status}`);
  }
  return json;
}

/** Garante um customer Asaas para o usuário (cria e cacheia no banco). */
export async function ensureCustomer(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.asaasCustomerId) return user.asaasCustomerId;
  const customer = await asaas("POST", "/customers", {
    name: user.name || `Cliente ${user.phone}`,
    mobilePhone: user.phone.replace("+55", ""),
    ...(user.cpf ? { cpfCnpj: user.cpf } : {}),
    externalReference: user.id,
  });
  await prisma.user.update({ where: { id: userId }, data: { asaasCustomerId: customer.id } });
  return customer.id as string;
}

export type CreatedCharge = {
  paymentId: string;
  invoiceUrl: string | null;
  pixPayload: string | null;
};

export type DadosCartao = {
  numero: string;
  nome: string;            // como está impresso no cartão
  mes: string;             // MM
  ano: string;             // AAAA
  cvv: string;
  /** Titular (exigido pelo Asaas na cobrança por cartão). */
  cpfCnpj: string;
  cep: string;
  numeroEndereco: string;
  email?: string;
  telefone?: string;
};

/**
 * Cobrança no CARTÃO sem sair do app: manda os dados direto para o Asaas
 * (creditCard + creditCardHolderInfo) em vez de devolver um link de
 * checkout. O cartão NÃO é gravado aqui — vai para o Asaas e o que volta é
 * só o status da cobrança.
 *
 * Crédito é sempre à vista (1x) e débito usa o mesmo caminho: para recarga
 * de saldo, parcelar não faz sentido — o cliente põe crédito e usa.
 */
export async function cobrarNoCartao(
  userId: string,
  amountCents: number,
  cartao: DadosCartao,
  tipo: "CREDITO" | "DEBITO" = "CREDITO",
  ipDoCliente?: string
): Promise<{ paymentId: string; status: "PAID" | "PENDING" | "FAILED" }> {
  const customer = await ensureCustomer(userId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const hoje = new Date().toISOString().slice(0, 10);

  const payment = await asaas("POST", "/payments", {
    customer,
    billingType: tipo === "DEBITO" ? "DEBIT_CARD" : "CREDIT_CARD",
    value: amountCents / 100,
    dueDate: hoje,
    description: "Recarga de saldo — PILI CLEAN",
    externalReference: userId,
    installmentCount: 1,          // sempre à vista
    creditCard: {
      holderName: cartao.nome,
      number: cartao.numero.replace(/\D/g, ""),
      expiryMonth: cartao.mes,
      expiryYear: cartao.ano,
      ccv: cartao.cvv,
    },
    creditCardHolderInfo: {
      name: cartao.nome,
      email: cartao.email || `${user.phone.replace(/\D/g, "")}@pililave.com.br`,
      cpfCnpj: cartao.cpfCnpj.replace(/\D/g, ""),
      postalCode: cartao.cep.replace(/\D/g, ""),
      addressNumber: cartao.numeroEndereco,
      phone: (cartao.telefone || user.phone).replace(/\D/g, ""),
    },
    // o Asaas exige o IP de quem está pagando para a análise antifraude
    ...(ipDoCliente ? { remoteIp: ipDoCliente } : {}),
  });

  const st = String(payment?.status ?? "");
  const status = ["RECEIVED", "CONFIRMED"].includes(st)
    ? "PAID"
    : ["PENDING", "AWAITING_RISK_ANALYSIS"].includes(st)
      ? "PENDING"
      : "FAILED";
  return { paymentId: payment.id as string, status };
}

/** Cria cobrança de recarga. PIX devolve o copia-e-cola; cartão devolve o checkout. */
export async function createCharge(
  userId: string,
  amountCents: number,
  method: "PIX" | "CARD"
): Promise<CreatedCharge> {
  const customer = await ensureCustomer(userId);
  const today = new Date().toISOString().slice(0, 10);
  const payment = await asaas("POST", "/payments", {
    customer,
    billingType: method === "PIX" ? "PIX" : "CREDIT_CARD",
    value: amountCents / 100,
    dueDate: today,
    description: "Recarga de saldo — PILI CLEAN",
    externalReference: userId,
  });

  let pixPayload: string | null = null;
  if (method === "PIX") {
    const qr = await asaas("GET", `/payments/${payment.id}/pixQrCode`);
    pixPayload = qr?.payload ?? null;
  }
  return { paymentId: payment.id, invoiceUrl: payment.invoiceUrl ?? null, pixPayload };
}

export async function getChargeStatus(paymentId: string): Promise<"PENDING" | "PAID" | "FAILED"> {
  const p = await asaas("GET", `/payments/${paymentId}`);
  const st = String(p?.status ?? "");
  if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(st)) return "PAID";
  if (["PENDING", "AWAITING_RISK_ANALYSIS"].includes(st)) return "PENDING";
  return "FAILED";
}
