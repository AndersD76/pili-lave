"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Me } from "./client";

const BASE = [
  { href: "/app", label: "Início", ic: "●" },
  { href: "/app/recarga", label: "Carteira", ic: "R$" },
  { href: "/app/historico", label: "Histórico", ic: "≡" },
];
const PERFIL = { href: "/app/perfil", label: "Perfil", ic: "☺" };

/**
 * Barra de baixo — igual ao app nativo (mobile/(tabs)/_layout.tsx): quem é
 * Lavador/Parceiro aprovado ganha aba de VERDADE aqui ("Minha Máquina" e/ou
 * "Comissões"), não só um botão escondido dentro do Perfil. Busca /api/me
 * uma vez pra decidir quais abas mostrar — funciona em qualquer página que
 * renderize <Nav />.
 */
export function Nav() {
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api<Me>("/api/me").then(setMe).catch(() => {});
  }, []);

  const temMinhaMaquina =
    me?.role === "LAVADOR" || me?.role === "ADMIN" ||
    (me?.solicitacoes ?? []).some((s) => s.tipo === "LAVADOR" && s.status === "APROVADA");
  const temComissoes = (me?.solicitacoes ?? []).some((s) => s.tipo !== "LAVADOR" && s.status === "APROVADA");

  const items = [
    ...BASE,
    ...(temMinhaMaquina ? [{ href: "/app/minha-maquina", label: "Minha Máq.", ic: "🔧" }] : []),
    ...(temComissoes ? [{ href: "/app/comissoes", label: "Comissões", ic: "R$" }] : []),
    PERFIL,
  ];

  return (
    <nav className="nav">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={path === i.href ? "on" : ""}>
          <span className="ic">{i.ic}</span>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
