import { createHash, randomInt } from "crypto";
import { prisma } from "./prisma";

const OTP_TTL_MIN = 5;
const MAX_PER_HOUR = 5;

export function hashCode(code: string): string {
  return createHash("sha256").update(code + process.env.JWT_SECRET).digest("hex");
}

/** Normaliza para E.164 Brasil: aceita "54999648368", "(54) 99964-8368", "+55…". */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const national = digits.startsWith("55") ? digits.slice(2) : digits;
  if (national.length < 10 || national.length > 11) return null;
  return `+55${national}`;
}

export async function requestOtp(phone: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const oneHourAgo = new Date(Date.now() - 3600_000);
  const recent = await prisma.otp.count({ where: { phone, createdAt: { gte: oneHourAgo } } });
  if (recent >= MAX_PER_HOUR) return { ok: false, error: "Muitas tentativas. Aguarde uma hora." };

  const code = String(randomInt(100000, 999999));
  await prisma.otp.create({
    data: { phone, codeHash: hashCode(code), expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000) },
  });
  await sendSms(phone, `PILI LAVE: seu código é ${code}. Vale por ${OTP_TTL_MIN} minutos.`);
  await prisma.event.create({ data: { type: "otp_sent", payload: { phone } } });
  return { ok: true };
}

export async function verifyOtp(phone: string, code: string): Promise<boolean> {
  const otp = await prisma.otp.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return false;
  if (otp.attempts >= 5) return false;
  if (otp.codeHash !== hashCode(code)) {
    await prisma.otp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return false;
  }
  await prisma.otp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  return true;
}

/** Envio plugável. "console" (dev) loga o código; produção: BrasilSMS/Twilio via env. */
async function sendSms(phone: string, message: string): Promise<void> {
  const provider = process.env.SMS_PROVIDER ?? "console";
  if (provider === "console") {
    console.log(`[SMS console] ${phone}: ${message}`);
    return;
  }
  if (provider === "brasilsms") {
    // https://brasilsms.com — POST simples com api_key; R$5 de crédito de teste
    await fetch("https://api.brasilsms.com/v1/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.SMS_API_KEY}` },
      body: JSON.stringify({ to: phone, message }),
    }).catch((e) => console.error("SMS falhou:", e));
    return;
  }
  console.error(`SMS_PROVIDER desconhecido: ${provider} — código não enviado`);
}
