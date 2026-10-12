"use server";

import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { gravarConfig, lerConfig, lojaConfigurada, NUVEM_URL, SENHA_FABRICA } from "@/lib/config";
import { cadastrarLojaNaNuvem, ErroNuvem } from "@/lib/nuvem";

/** Volta pra tela mantendo a cidade buscada, com a mensagem de erro. */
function voltar(cidade: string, erro: string, substituir = false): never {
  const qs = new URLSearchParams({ cidade, erro });
  if (substituir) qs.set("substituir", "1");
  redirect(`/primeiro-uso?${qs.toString()}`);
}

/**
 * Cadastro da loja no primeiro uso — mesma lógica da máquina de lavagem:
 * este computador gera a própria identidade e o técnico escolhe um endereço
 * da lista (loja ou unidade de lavagem já cadastrada) ou digita um novo.
 * Quem faz isso é o técnico da instalação — não precisa de usuário.
 */
export async function cadastrarLoja(formData: FormData) {
  if (await lojaConfigurada()) redirect("/");

  const cidade = String(formData.get("cidade") ?? "").trim();
  const escolha = String(formData.get("escolha") ?? "");
  const rua = String(formData.get("rua") ?? "").trim();
  const nome = String(formData.get("nome") ?? "").trim();

  if (!escolha) voltar(cidade, "Escolha um endereço da lista ou marque \"Endereço novo\".");
  if (escolha === "novo" && !rua) voltar(cidade, "Digite a rua e o número do endereço novo.");

  // Identidade deste computador: gerada uma vez e guardada ANTES de chamar a
  // nuvem — se a chamada falhar e o técnico tentar de novo, é a mesma.
  let deviceKey = await lerConfig("deviceKey");
  if (!deviceKey) {
    deviceKey = `loja-${randomBytes(24).toString("hex")}`;
    await gravarConfig({ deviceKey });
  }

  const [tipo, id] = escolha.split(":");
  const destino =
    tipo === "loja" ? { lojaId: id } : tipo === "lavagem" ? { stationId: id } : { cidade, rua };

  let loja;
  try {
    loja = await cadastrarLojaNaNuvem(NUVEM_URL, SENHA_FABRICA, {
      deviceKey, ...destino, nome: nome || undefined, substituir: formData.get("substituir") === "on",
    });
  } catch (e) {
    if (e instanceof ErroNuvem) voltar(cidade, e.message, e.precisaSubstituir);
    throw e;
  }

  await gravarConfig({
    lojaId: loja.id, lojaNome: loja.nome, lojaCidade: loja.cidade, lojaRua: loja.rua,
    lojaCapacidade: String(loja.capacidade),
  });
  // Não cria senha aqui: quem entra na gestão é o lojista (definido pelo
  // admin na nuvem) e os funcionários que ele cadastrar.
  redirect("/");
}
