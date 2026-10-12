import Link from "next/link";
import { redirect } from "next/navigation";
import { lojaConfigurada } from "@/lib/config";
import { usuarioDaSessao } from "@/lib/sessao";
import { entrar } from "./actions";

export const dynamic = "force-dynamic";

const ERROS: Record<string, string> = {
  dados: "Usuário ou senha incorretos.",
  dono: "Essa conta não é a dona desta loja. Quem define o dono é o administrador.",
  conexao:
    "Não foi possível falar com o servidor para conferir o lojista. Confira a internet. (Sem internet, o lojista só entra depois de já ter entrado uma vez neste computador.)",
};

/** Acesso administrativo: usuário e senha. O lojista usa o e-mail e a senha
 *  do app; o funcionário, o usuário que o lojista cadastrou. */
export default async function Entrar({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const loja = await lojaConfigurada();
  if (!loja) redirect("/primeiro-uso");
  if (await usuarioDaSessao()) redirect("/gestao");
  const { erro } = await searchParams;

  return (
    <main className="admin-wrap">
      <form action={entrar} className="login-card">
        <h2>Acesso administrativo</h2>
        <p className="sub">{loja.nome} · {loja.cidade}</p>
        <input
          className="field" name="usuario" placeholder="Usuário (lojista: e-mail do app)" autoFocus required
          autoCapitalize="none" autoComplete="username"
        />
        <input className="field" type="password" name="senha" placeholder="Senha" required autoComplete="current-password" />
        {erro && <p className="err-msg">{ERROS[erro] ?? ERROS.dados}</p>}
        <button className="btn" type="submit">Entrar</button>
        <Link href="/" className="sub" style={{ textAlign: "center" }}>Voltar para a tela do cliente</Link>
      </form>
    </main>
  );
}
