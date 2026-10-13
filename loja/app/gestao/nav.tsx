import Link from "next/link";
import type { Loja } from "@/lib/config";
import { pode, type Permissao, type UsuarioGestao } from "@/lib/permissoes";
import { sair } from "../entrar/actions";

/** `perm`: só aparece pra quem tem essa permissão. `soLojista`: só pro lojista. */
const LINKS: { href: string; label: string; soLojista?: boolean; perm?: Permissao }[] = [
  { href: "/gestao", label: "Painel" },
  { href: "/gestao/produtos", label: "Produtos e estoque" },
  { href: "/gestao/compras", label: "Compras", perm: "COMPRAS" },
  { href: "/gestao/entradas", label: "Entradas", perm: "ENTRADA" },
  { href: "/gestao/relatorios", label: "Relatórios", perm: "RELATORIOS" },
  { href: "/gestao/vendas", label: "Vendas", soLojista: true },
  { href: "/gestao/usuarios", label: "Usuários", soLojista: true },
  { href: "/gestao/atividades", label: "Atividades", soLojista: true },
];

/** Barra do topo da gestão — mesma cara do painel admin da nuvem. Mostra
 *  quem está logado: tudo o que for feito fica registrado nesse nome. */
export function Nav({ loja, usuario, atual }: { loja: Loja; usuario: UsuarioGestao; atual: string }) {
  return (
    <nav className="admin-nav" style={{ flexWrap: "wrap" }}>
      <span className="logo">PILI LOJA<span>.</span></span>
      {LINKS.filter((l) => (!l.soLojista || usuario.papel === "LOJISTA") && (!l.perm || pode(usuario, l.perm))).map((l) => (
        <Link key={l.href} href={l.href} className={l.href === atual ? "on" : ""}>{l.label}</Link>
      ))}
      <span className="sub" style={{ marginLeft: "auto", textAlign: "right" }}>
        {usuario.nome} ({usuario.papel === "LOJISTA" ? "lojista" : "funcionário"})
        <span style={{ display: "block", fontSize: 12 }}>{loja.nome} · {loja.cidade}</span>
      </span>
      <form action={sair}>
        <button className="btn ghost" type="submit">Sair</button>
      </form>
    </nav>
  );
}
