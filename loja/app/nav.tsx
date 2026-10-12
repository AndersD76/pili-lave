import Link from "next/link";
import type { Loja } from "@/lib/config";
import { sair } from "./entrar/actions";

const LINKS = [
  { href: "/", label: "Painel" },
  { href: "/produtos", label: "Produtos e estoque" },
];

/** Barra do topo da gestão — mesma cara do painel admin da nuvem. */
export function Nav({ loja, atual }: { loja: Loja; atual: string }) {
  return (
    <nav className="admin-nav">
      <span className="logo">PILI LOJA<span>.</span></span>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={l.href === atual ? "on" : ""}>{l.label}</Link>
      ))}
      <span className="sub" style={{ marginLeft: "auto" }}>{loja.nome} · {loja.cidade}</span>
      <form action={sair}>
        <button className="btn ghost" type="submit">Sair</button>
      </form>
    </nav>
  );
}
