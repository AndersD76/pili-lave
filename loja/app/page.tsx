import Link from "next/link";
import { redirect } from "next/navigation";
import { lojaConfigurada } from "@/lib/config";
import { Caixa } from "./Caixa";

export const dynamic = "force-dynamic";

/**
 * Tela principal do computador da loja: a do CLIENTE — o caixa de
 * autoatendimento. É o que fica aberto o tempo todo. A gestão fica atrás do
 * botão discreto no canto, com usuário e senha.
 */
export default async function TelaCliente() {
  const loja = await lojaConfigurada();
  if (!loja) redirect("/primeiro-uso");

  return (
    <main className="caixa-tela">
      <Caixa lojaNome={loja.nome} />
      <Link href="/entrar" className="caixa-admin">Acesso administrativo</Link>
    </main>
  );
}
