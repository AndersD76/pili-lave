/* eslint-disable @next/next/no-img-element */
/**
 * Marca PILI CLEAN. Usa a logo real (arquivo enviado pelo cliente) em vez
 * do texto — a logo tem o "P" e a tipografia próprios, que o texto não
 * reproduz.
 *
 * O arquivo servido já vem SEM a moldura preta do original (quase metade da
 * imagem era margem, o que fazia a marca aparecer minúscula numa faixa
 * larga) e com fundo transparente, para assentar sobre o fundo do app.
 */
export function Logo({ altura = 46 }: { altura?: number }) {
  return (
    <img
      src="/logo-pili-clean.png"
      alt="PILI CLEAN"
      style={{ height: altura, width: "auto", display: "block" }}
    />
  );
}
