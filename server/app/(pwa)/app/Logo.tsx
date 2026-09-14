/* eslint-disable @next/next/no-img-element */
/**
 * Marca PILI CLEAN. Usa a logo real (arquivo enviado pelo cliente) em vez
 * do texto — a logo tem o "P" e a tipografia próprios, que o texto não
 * reproduz.
 *
 * O arquivo servido já vem SEM a moldura preta do original (quase metade da
 * imagem era margem) e com fundo transparente, para assentar sobre o fundo
 * do app. A altura é a original (34px) — o que deformava a imagem era o
 * container flex, não o tamanho.
 */
export function Logo({ altura = 34 }: { altura?: number }) {
  return (
    <img
      src="/logo-pili-clean.png"
      alt="PILI CLEAN"
      /* alignSelf:"flex-start" é o que impede a deformação: o container
         .pw é flex em coluna e estica os filhos na largura (align-items:
         stretch é o padrão), então a imagem era puxada para 444px de
         largura mantendo a altura — daí o aspecto achatado. */
      style={{
        height: altura,
        width: "auto",
        alignSelf: "flex-start",
        objectFit: "contain",
        display: "block",
      }}
    />
  );
}
