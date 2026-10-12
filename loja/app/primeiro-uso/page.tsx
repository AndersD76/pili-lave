import { redirect } from "next/navigation";
import { lojaConfigurada, NUVEM_URL, SENHA_FABRICA } from "@/lib/config";
import { buscarEnderecos, ErroNuvem, type EnderecoNuvem } from "@/lib/nuvem";
import { cadastrarLoja } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Primeira ligada do computador da loja. Passo 1: buscar a cidade. Passo 2:
 * escolher um endereço que já existe (outra loja, ou uma unidade de lavagem
 * no mesmo lugar) ou digitar um novo, e criar a senha de gestão. Depois de
 * cadastrada, esta tela nunca mais aparece sozinha.
 */
export default async function PrimeiroUso({
  searchParams,
}: {
  searchParams: Promise<{ cidade?: string; erro?: string; substituir?: string }>;
}) {
  if (await lojaConfigurada()) redirect("/");
  const { cidade: cidadeParam, erro, substituir } = await searchParams;
  const cidade = cidadeParam?.trim() ?? "";

  let enderecos: EnderecoNuvem[] | null = null;
  let erroBusca = "";
  if (cidade.length >= 2) {
    try {
      enderecos = await buscarEnderecos(NUVEM_URL, SENHA_FABRICA, cidade);
    } catch (e) {
      erroBusca = e instanceof ErroNuvem ? e.message : "Não foi possível buscar os endereços.";
    }
  }

  return (
    <main className="admin-wrap" style={{ maxWidth: 640 }}>
      <h1>Cadastro da loja</h1>
      <p className="sub" style={{ marginBottom: 24 }}>
        Este computador ainda não está vinculado a nenhuma loja. Busque a cidade para ver os endereços que já
        existem — assim a loja não é cadastrada duas vezes.
      </p>

      <form method="get" className="card linha-form">
        <label className="rotulo" style={{ flex: 1 }}>
          Cidade
          <input className="field" name="cidade" defaultValue={cidade} placeholder="Ex.: Erechim" minLength={2} required />
        </label>
        <button className="btn" type="submit" style={{ height: 40 }}>Buscar</button>
      </form>
      {erroBusca && <p className="err-msg" style={{ marginTop: 12 }}>{erroBusca}</p>}
      <p className="sub" style={{ marginTop: 8, fontSize: 12 }}>Servidor: {NUVEM_URL}</p>

      {enderecos && (
        <form action={cadastrarLoja} className="card" style={{ marginTop: 20, display: "grid", gap: 14 }}>
          <input type="hidden" name="cidade" value={cidade} />
          <b>Onde esta loja fica?</b>
          {enderecos.length === 0 && <p className="sub">Nenhum endereço cadastrado nessa cidade ainda.</p>}
          {enderecos.map((e) => {
            const valor = e.lojaId ? `loja:${e.lojaId}` : `lavagem:${e.stationId}`;
            return (
              <label key={valor} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                <input type="radio" name="escolha" value={valor} style={{ marginTop: 5 }} />
                <span>
                  {e.rua || e.nome} · {e.cidade}
                  <span className="sub" style={{ display: "block" }}>
                    {e.lojaId
                      ? e.temComputador
                        ? "Loja já cadastrada, com computador vinculado (escolha só se estiver trocando o computador)"
                        : "Loja já cadastrada, ainda sem computador"
                      : "Unidade de lavagem — a loja fica no mesmo endereço"}
                  </span>
                </span>
              </label>
            );
          })}
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="radio" name="escolha" value="novo" style={{ marginTop: 5 }} />
            <span style={{ flex: 1 }}>
              Endereço novo em {cidade}
              <input className="field" name="rua" placeholder="Rua e número" style={{ marginTop: 6 }} maxLength={120} />
            </span>
          </label>

          <label className="rotulo">
            Nome da loja (opcional — sem ele, fica o endereço)
            <input className="field" name="nome" maxLength={60} />
          </label>

          <b style={{ marginTop: 6 }}>Senha de gestão</b>
          <p className="sub">
            Protege o estoque e os cadastros neste computador. Quem não tem a senha só usa o caixa.
          </p>
          <div className="linha-form">
            <label className="rotulo" style={{ flex: 1 }}>
              Senha (mínimo 6 caracteres)
              <input className="field" type="password" name="senha" required minLength={6} />
            </label>
            <label className="rotulo" style={{ flex: 1 }}>
              Repita a senha
              <input className="field" type="password" name="senha2" required minLength={6} />
            </label>
          </div>

          {substituir && (
            <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" name="substituir" />
              Confirmo: este computador substitui o que estava vinculado a essa loja
            </label>
          )}
          {erro && <p className="err-msg">{erro}</p>}
          <button className="btn" type="submit">Cadastrar esta loja</button>
        </form>
      )}
    </main>
  );
}
