"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Visão geral" },
  { href: "/admin/lavagens", label: "Lavagens" },
  { href: "/admin/usuarios", label: "Usuários" },
  { href: "/admin/maquinas", label: "Máquinas" },
  { href: "/admin/lojas", label: "Lojas" },
  { href: "/admin/precos", label: "Preços" },
  { href: "/admin/repasses", label: "Repasses" },
];

/** Menu do admin com a página atual GRIFADA (classe "ativo"), para saber em qual aba se está. */
export default function NavLinks({ pendentes }: { pendentes: number }) {
  const pathname = usePathname() ?? "";
  const ativo = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/"));

  return (
    <>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={ativo(l.href) ? "ativo" : undefined} aria-current={ativo(l.href) ? "page" : undefined} style={{ position: "relative" }}>
          {l.label}
          {l.href === "/admin/usuarios" && pendentes > 0 && (
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
      ))}
    </>
  );
}
