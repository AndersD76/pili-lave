"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/app", label: "Início", ic: "●" },
  { href: "/app/recarga", label: "Carteira", ic: "R$" },
  { href: "/app/historico", label: "Histórico", ic: "≡" },
  { href: "/app/perfil", label: "Perfil", ic: "☺" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} className={path === i.href ? "on" : ""}>
          <span className="ic">{i.ic}</span>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
