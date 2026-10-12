import { lerPermissoes, PERMISSOES, type Permissao } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { exigirLojista } from "@/lib/sessao";
import { Nav } from "../nav";
import { criarFuncionario, salvarFuncionario } from "./actions";

export const dynamic = "force-dynamic";

/** Um checkbox por permissão — o mesmo bloco no cadastro e na edição. */
function Permissoes({ marcadas }: { marcadas: Permissao[] }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span className="rotulo">O que este funcionário pode fazer</span>
      {PERMISSOES.map((p) => (
        <label key={p.chave} className="sub" style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" name={`perm_${p.chave}`} defaultChecked={marcadas.includes(p.chave)} />
          {p.rotulo}
        </label>
      ))}
      <span className="sub" style={{ fontSize: 12 }}>
        Ver o painel e consultar produtos e estoque todo funcionário ativo pode.
      </span>
    </div>
  );
}

/**
 * Usuários da gestão — só o lojista entra aqui. Ele cadastra os
 * funcionários e marca o que cada um pode fazer; tudo o que fizerem fica
 * registrado no nome de cada um (ver Atividades).
 */
export default async function Usuarios({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { loja, usuario } = await exigirLojista();
  const { erro, ok } = await searchParams;
  const funcionarios = await prisma.usuario.findMany({
    where: { papel: "FUNCIONARIO" },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
  });

  return (
    <main className="admin-wrap">
      <Nav loja={loja} usuario={usuario} atual="/gestao/usuarios" />
      <p className="sub" style={{ marginBottom: 6 }}>
        Você, como lojista, tem acesso total. Cada funcionário entra com o próprio usuário e senha, e só faz o que
        estiver marcado aqui.
      </p>
      {erro && <p className="err-msg">{erro}</p>}
      {ok && <p className="ok-msg">Salvo.</p>}

      <h2 className="section-title">Funcionários ({funcionarios.length})</h2>
      {funcionarios.length === 0 && <p className="sub">Nenhum funcionário cadastrado.</p>}
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        {funcionarios.map((f) => (
          <form
            key={f.id} action={salvarFuncionario} className="card"
            style={{ display: "grid", gap: 12, opacity: f.ativo ? 1 : 0.6 }}
          >
            <input type="hidden" name="id" value={f.id} />
            <b>{f.login}{f.ativo ? "" : " (desativado)"}</b>
            <label className="rotulo">
              Nome
              <input className="field" name="nome" defaultValue={f.nome} maxLength={60} required />
            </label>
            <Permissoes marcadas={lerPermissoes(f.permissoes)} />
            <label className="rotulo">
              Nova senha (deixe em branco para não trocar)
              <input className="field" type="password" name="senha" autoComplete="new-password" />
            </label>
            <label className="sub" style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" name="ativo" defaultChecked={f.ativo} />
              Usuário ativo (desmarque para tirar o acesso sem apagar o histórico)
            </label>
            <button className="btn ghost" type="submit" style={{ justifySelf: "start" }}>Salvar</button>
          </form>
        ))}
      </div>

      <h2 className="section-title">Novo funcionário</h2>
      <form action={criarFuncionario} className="card" style={{ display: "grid", gap: 12, maxWidth: 520 }}>
        <label className="rotulo">
          Nome
          <input className="field" name="nome" maxLength={60} required />
        </label>
        <div className="linha-form">
          <label className="rotulo" style={{ flex: 1 }}>
            Usuário (para entrar)
            <input className="field" name="login" maxLength={30} required autoCapitalize="none" placeholder="ex.: maria" />
          </label>
          <label className="rotulo" style={{ flex: 1 }}>
            Senha (mínimo 6 caracteres)
            <input className="field" type="password" name="senha" minLength={6} required autoComplete="new-password" />
          </label>
        </div>
        <Permissoes marcadas={[]} />
        <button className="btn" type="submit" style={{ justifySelf: "start" }}>Cadastrar funcionário</button>
      </form>
    </main>
  );
}
