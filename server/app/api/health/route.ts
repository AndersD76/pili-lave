import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** Diagnóstico seguro: mostra QUAIS envs existem (nunca os valores) e testa o banco. */
export async function GET() {
  const env = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    DIRECT_URL: !!process.env.DIRECT_URL,
    JWT_SECRET: !!process.env.JWT_SECRET,
    ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD,
    DEVICE_KEY: !!process.env.DEVICE_KEY,
    OTP_MASTER_CODE: !!process.env.OTP_MASTER_CODE,
    ASAAS_API_KEY: !!process.env.ASAAS_API_KEY,
    ASAAS_WEBHOOK_TOKEN: !!process.env.ASAAS_WEBHOOK_TOKEN,
  };
  let db = "ok";
  try {
    await prisma.program.count();
  } catch (e) {
    db = e instanceof Error ? e.message.slice(0, 300) : "erro desconhecido";
  }
  return NextResponse.json({ env, db });
}
