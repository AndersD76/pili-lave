import { PrismaClient } from "@prisma/client";

/* ============================================================
 * FASE DE TESTE: se o ambiente não tiver DATABASE_URL (ex.:
 * variáveis não configuradas no Railway), usa o Neon direto.
 * REMOVER este fallback antes de produção de verdade e trocar
 * a senha do banco no painel do Neon.
 * ============================================================ */
process.env.DATABASE_URL ??=
  "postgresql://neondb_owner:npg_mFY2n4iOfyIu@ep-plain-shape-aywvr2xz-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
