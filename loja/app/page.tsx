import Link from "next/link";
import { redirect } from "next/navigation";
import { lojaConfigurada } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Tela principal do computador da loja: a do CLIENTE. É o que fica aberto o
 * tempo todo. O caixa de autoatendimento (ler os produtos, pagar) entra
 * aqui na etapa 3; por enquanto é só a recepção. A gestão fica atrás do
 * botão discreto no canto, com usuário e senha.
 */
export default async function TelaCliente() {
  const loja = await lojaConfigurada();
  if (!loja) redirect("/primeiro-uso");

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, position: "relative" }}>
      <div style={{ textAlign: "center", maxWidth: 560 }}>
        <p className="sub" style={{ letterSpacing: "0.12em", textTransform: "uppercase" }}>{loja.nome}</p>
        <h1 style={{ fontSize: 44, margin: "10px 0 14px" }}>Bem-vindo</h1>
        <p className="sub" style={{ fontSize: 18 }}>
          O caixa de autoatendimento vai funcionar nesta tela: você passa os produtos no leitor e paga aqui mesmo.
        </p>
        <p className="sub" style={{ marginTop: 18 }}>Em instalação — ainda não disponível.</p>
      </div>
      <Link
        href="/entrar" className="btn ghost"
        style={{ position: "absolute", right: 16, bottom: 16, display: "inline-flex", alignItems: "center" }}
      >
        Acesso administrativo
      </Link>
    </main>
  );
}
