import Link from "next/link";
import { prisma } from "@/lib/prisma";

export async function AdminNav() {
  const pendentes = await prisma.user.count({ where: { cadastroPendente: true } });

  return (
    <nav className="admin-nav">
      <span className="logo">PILI CLEAN<span>.</span></span>
      <Link href="/admin">Visão geral</Link>
      <Link href="/admin/lavagens">Lavagens</Link>
      <Link href="/admin/usuarios" style={{ position: "relative" }}>
        Usuários
        {pendentes > 0 && (
          <span
            style={{
              position: "absolute", top: -6, right: -14,
              background: "var(--erro, #e05555)", color: "#fff",
              borderRadius: 999, fontSize: 10, fontWeight: 700,
              minWidth: 16, height: 16, lineHeight: "16px", textAlign: "center", padding: "0 3px",
            }}
          >
            {pendentes}
          </span>
        )}
      </Link>
      <Link href="/admin/maquinas">Máquinas</Link>
      <Link href="/admin/precos">Preços</Link>
    </nav>
  );
}
