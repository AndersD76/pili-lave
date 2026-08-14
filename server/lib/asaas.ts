import { prisma } from "./prisma";

const BASE = process.env.ASAAS_BASE_URL ?? "https://api-sandbox.asaas.com/v3";

async function asaas(method: string, path: string, body?: unknown) {
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
    description: "Recarga de saldo — PILI LAVE",
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
