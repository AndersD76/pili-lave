import { reaisCampo } from "@/lib/dinheiro";
import { CampoPreco } from "./CampoPreco";

type ProdutoForm = {
  nome: string; ean: string | null; unidade: string; custoCents: number; precoCents: number | null;
  estoqueMinimo: number; margemPct: number | null; precoManual: boolean;
};

/** Campos do cadastro de produto — os mesmos pra criar e pra editar.
 *  `podeCadastro`/`podePreco` travam os campos que o usuário não pode mudar
 *  (o servidor confere de novo ao salvar; aqui é só pra não enganar a tela).
 *  Campo travado usa readOnly, não disabled: disabled não é enviado, e o
 *  servidor leria o campo vazio como "apagou". */
export function CamposProduto({
  produto, podeCadastro = true, podePreco = true,
}: { produto?: ProdutoForm; podeCadastro?: boolean; podePreco?: boolean }) {
  const travado = { readOnly: true, style: { opacity: 0.6 } } as const;
  const cad = podeCadastro ? {} : travado;
  return (
    <>
      <div className="linha-form">
        <label className="rotulo" style={{ flex: 2, minWidth: 240 }}>
          Nome
          <input className="field" name="nome" defaultValue={produto?.nome} maxLength={80} required {...cad} />
        </label>
        <label className="rotulo" style={{ flex: 1, minWidth: 170 }}>
          Código de barras
          <input className="field" name="ean" defaultValue={produto?.ean ?? ""} inputMode="numeric" maxLength={14} {...cad} />
        </label>
      </div>
      <div className="linha-form">
        <label className="rotulo" style={{ width: 130 }}>
          Custo (R$)
          <input className="field" name="custo" defaultValue={reaisCampo(produto?.custoCents ?? 0)} inputMode="decimal" {...cad} />
        </label>
        <label className="rotulo" style={{ width: 130 }}>
          Estoque mínimo
          <input className="field" name="estoqueMinimo" defaultValue={produto?.estoqueMinimo ?? 5} inputMode="numeric" {...cad} />
        </label>
        <label className="rotulo" style={{ width: 90 }}>
          Unidade
          <input className="field" name="unidade" defaultValue={produto?.unidade ?? "UN"} maxLength={4} {...cad} />
        </label>
      </div>
      <CampoPreco
        custoCents={produto?.custoCents ?? 0} margemPct={produto?.margemPct ?? null}
        precoCents={produto?.precoCents ?? null} precoManual={produto?.precoManual ?? false} travado={!podePreco}
      />
    </>
  );
}
