/* eslint-disable @next/next/no-img-element */
/**
 * Marca PILI CLEAN. Usa a logo real (arquivo enviado pelo cliente) em vez
 * do texto — a logo tem o "P" e a tipografia próprios, que o texto não
 * reproduz. Fica em <img> simples porque o arquivo já vem no tamanho certo
 * e a tela não depende de otimização aqui.
 */
export function Logo({ altura = 34 }: { altura?: number }) {
  return (
    <img
      src="/logo-pili-clean.png"
      alt="PILI CLEAN"
      style={{ height: altura, width: "auto", display: "block" }}
    />
  );
}
