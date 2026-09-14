/* eslint-disable @next/next/no-img-element */
/**
 * Marca PILI CLEAN. Usa a logo real (arquivo enviado pelo cliente) em vez
 * do texto — a logo tem o "P" e a tipografia próprios, que o texto não
 * reproduz.
 *
 * A imagem é o arquivo original, com a proporção 3:1 intacta — recortar a
 * moldura preta mudava a proporção (a margem não é simétrica) e era isso
 * que deixava a logo com aspecto esticado.
 *
 * Como o desenho ocupa só ~55% da altura do arquivo (o resto é moldura),
 * a altura aqui é maior para a marca aparecer no tamanho certo: 62px de
 * caixa ≈ 34px de desenho visível.
 */
export function Logo({ altura = 62 }: { altura?: number }) {
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
