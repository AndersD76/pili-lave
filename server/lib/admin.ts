import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "pililave-teste-8512eff13d539f76");
export const ADMIN_COOKIE = "pl_admin";

/** FASE DE TESTE: sem ADMIN_PASSWORD configurada, o painel fica aberto. */
export function adminOpen(): boolean {
  return !process.env.ADMIN_PASSWORD;
}

export async function createAdminCookie(): Promise<string> {
  return new SignJWT({ role: "ADMIN" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function isAdmin(): Promise<boolean> {
  if (adminOpen()) return true;
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload.role === "ADMIN";
  } catch {
    return false;
  }
}

export async function requireAdminPage(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}
