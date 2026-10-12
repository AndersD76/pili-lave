import { reaisCampo } from "@/lib/dinheiro";

type ProdutoForm = {
  nome: string; ean: string | null; unidade: string; custoCents: number; precoCents: number | null;
  estoqueMinimo: number;
};

/** Campos do cadastro de produto — os mesmos pra criar e pra editar. */
export function CamposProduto({ produto }: { produto?: ProdutoForm }) {
  return (
    <>
      <div className="linha-form">
        <label className="rotulo" style={{ flex: 2, minWidth: 240 }}>
          Nome
          <input className="field" name="nome" defaultValue={produto?.nome} maxLength={80} required />
        </label>
        <label className="rotulo" style={{ flex: 1, minWidth: 170 }}>
          Código de barras
          <input className="field" name="ean" defaultValue={produto?.ean ?? ""} inputMode="numeric" maxLength={14} />
        </label>
      </div>
      <div className="linha-form">
        <label className="rotulo" style={{ width: 130 }}>
          Preço de venda (R$)
          <input className="field" name="preco" defaultValue={reaisCampo(produto?.precoCents ?? null)} inputMode="decimal" placeholder="sem preço" />
        </label>
        <label className="rotulo" style={{ width: 130 }}>
          Custo (R$)
          <input className="field" name="custo" defaultValue={reaisCampo(produto?.custoCents ?? 0)} inputMode="decimal" />
        </label>
        <label className="rotulo" style={{ width: 130 }}>
          Estoque mínimo
          <input className="field" name="estoqueMinimo" defaultValue={produto?.estoqueMinimo ?? 5} inputMode="numeric" />
        </label>
        <label className="rotulo" style={{ width: 90 }}>
          Unidade
          <input className="field" name="unidade" defaultValue={produto?.unidade ?? "UN"} maxLength={4} />
        </label>
      </div>
    </>
  );
}
