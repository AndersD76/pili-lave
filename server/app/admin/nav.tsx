import { prisma } from "@/lib/prisma";
import NavLinks from "./NavLinks";

export async function AdminNav() {
  const pendentes = await prisma.solicitacaoParceiro.count({ where: { status: "PENDENTE" } });

  return (
    <nav className="admin-nav">
      <span className="logo">PILI CLEAN<span>.</span></span>
      <NavLinks pendentes={pendentes} />
    </nav>
  );
}
