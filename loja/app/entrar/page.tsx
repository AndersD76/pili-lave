import { redirect } from "next/navigation";
import { lojaConfigurada } from "@/lib/config";
import { sessaoAberta } from "@/lib/sessao";
import { entrar } from "./actions";

export const dynamic = "force-dynamic";

export default async function Entrar({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const loja = await lojaConfigurada();
  if (!loja) redirect("/primeiro-uso");
  if (await sessaoAberta()) redirect("/");
  const { erro } = await searchParams;

  return (
    <main className="admin-wrap">
      <form action={entrar} className="login-card">
        <h2>Gestão da loja</h2>
        <p className="sub">{loja.nome} · {loja.cidade}</p>
        <input className="field" type="password" name="senha" placeholder="Senha de gestão" autoFocus required />
        {erro && <p className="err-msg">Senha incorreta.</p>}
        <button className="btn" type="submit">Entrar</button>
      </form>
    </main>
  );
}
