import Link from "next/link";

export function AdminNav() {
  return (
    <nav className="admin-nav">
      <span className="logo">PILI CLEAN<span>.</span></span>
      <Link href="/admin">Visão geral</Link>
      <Link href="/admin/lavagens">Lavagens</Link>
      <Link href="/admin/usuarios">Usuários</Link>
      <Link href="/admin/maquinas">Máquinas</Link>
    </nav>
  );
}
