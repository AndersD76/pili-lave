/**
 * Conferência da foto do rosto mandada pelo cliente (loja de conveniência):
 * tem que ser UMA pessoa de verdade, de frente, com o rosto visível — não
 * uma garrafa, um bicho, uma parede ou duas pessoas.
 *
 * Usa a mesma IA de visão da leitura de placa (lib/vision-claude.ts, mesma
 * ANTHROPIC_API_KEY). A pergunta é só "isto serve como foto de rosto?" —
 * NÃO identifica quem é a pessoa. O reconhecimento em si (comparar com quem
 * está no caixa) é outra etapa e roda no computador da loja.
 *
 * Limite conhecido: não distingue uma pessoa ao vivo de uma foto de uma
 * foto (não é prova de vida).
 */

const MODELO = "claude-opus-5-5";

const PROMPT =
  "Esta imagem foi enviada como foto de cadastro do rosto de um cliente. " +
  "Avalie apenas se ela serve para isso — não tente identificar quem é a pessoa. " +
  "Serve quando mostra exatamente UMA pessoa real, com o rosto inteiro visível, " +
  "de frente ou quase de frente, nítido e iluminado o bastante, sem óculos escuros, " +
  "máscara ou algo cobrindo o rosto. Não serve quando não há pessoa (objeto, animal, " +
  "paisagem, desenho, boneco), quando há mais de uma pessoa, ou quando o rosto está " +
  "cortado, de costas, de perfil, muito escuro ou borrado. " +
  'Responda SOMENTE JSON: {"serve":true|false,"problema":"SEM_PESSOA"|"MAIS_DE_UMA"|' +
  '"ROSTO_COBERTO"|"ROSTO_NAO_VISIVEL"|"IMAGEM_RUIM"|null}. ' +
  'Use "problema":null quando "serve" for true.';

/** O que dizer ao cliente em cada caso de recusa. */
const MENSAGEM: Record<string, string> = {
  SEM_PESSOA: "Não encontramos um rosto nessa foto. Tire uma foto do seu rosto, de frente.",
  MAIS_DE_UMA: "A foto precisa ter só você. Tire de novo, sem outras pessoas.",
  ROSTO_COBERTO: "Seu rosto está coberto. Tire a foto sem óculos escuros, máscara ou boné.",
  ROSTO_NAO_VISIVEL: "Seu rosto não aparece inteiro. Fique de frente para a câmera e tire de novo.",
  IMAGEM_RUIM: "A foto ficou escura ou borrada. Vá para um lugar claro e tire de novo.",
};
const MENSAGEM_PADRAO = "Essa foto não serve. Tire uma foto do seu rosto, de frente, em lugar claro.";

export type ResultadoRosto =
  | { situacao: "APROVADA" }
  | { situacao: "RECUSADA"; mensagem: string }
  /** Não deu pra conferir (sem chave da IA, falha de rede, resposta
   *  ilegível). Quem chama decide — hoje a foto é aceita e fica marcada como
   *  não conferida, pra uma indisponibilidade da IA não travar o cadastro. */
  | { situacao: "NAO_CONFERIDA"; motivo: string };

export async function conferirFotoRosto(jpeg: Buffer): Promise<ResultadoRosto> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { situacao: "NAO_CONFERIDA", motivo: "sem ANTHROPIC_API_KEY" };

  try {
    const sharp = (await import("sharp")).default;
    // .rotate() aplica a orientação do EXIF: foto de celular costuma vir deitada
    const img = await sharp(jpeg).rotate().resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 }).toBuffer();

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        // se o modelo recusar por política, a própria API tenta de novo no
        // modelo substituto recomendado, na mesma chamada
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODELO,
        fallbacks: "default",
        // o raciocínio do modelo conta dentro deste limite; a resposta em si é curta
        max_tokens: 2000,
        output_config: { effort: "low" },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.toString("base64") } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.error("Conferência de rosto falhou:", res.status, await res.text().catch(() => ""));
      return { situacao: "NAO_CONFERIDA", motivo: `API ${res.status}` };
    }
    const json = await res.json();
    if (json?.stop_reason === "refusal") return { situacao: "NAO_CONFERIDA", motivo: "modelo recusou" };

    const texto = ((json?.content ?? []) as { type: string; text?: string }[])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const o = JSON.parse(texto.replace(/```json|```/g, "").trim());
    if (typeof o?.serve !== "boolean") return { situacao: "NAO_CONFERIDA", motivo: "resposta sem veredito" };
    if (o.serve) return { situacao: "APROVADA" };
    return { situacao: "RECUSADA", mensagem: MENSAGEM[String(o.problema)] ?? MENSAGEM_PADRAO };
  } catch (e) {
    console.error("Conferência de rosto: erro", e);
    return { situacao: "NAO_CONFERIDA", motivo: "erro na chamada" };
  }
}
