import { XMLParser } from "fast-xml-parser";

/* Leitura do XML da NF-e (nota fiscal de mercadoria) que o fornecedor
 * manda. O XML é o documento oficial e tem campos exatos — diferente do PDF
 * (DANFE), que é só uma impressão e quase nunca traz o código de barras. */

export type ItemNota = {
  /** Código do produto NO FORNECEDOR (cProd) — é por ele que o sistema
   *  lembra, da próxima vez, qual produto da loja é este. */
  codigoFornecedor: string;
  descricao: string;
  /** Código de barras da unidade de venda, quando a nota traz um válido. */
  ean: string | null;
  /** Quantidade em UNIDADES de venda (ver comentário em lerNfe). */
  quantidade: number;
  unidade: string;
  /** Valor total do item na nota (vProd), em centavos. */
  totalCents: number;
  /** Como veio na nota, pra mostrar na conferência: "2 CX". */
  comoVeio: string;
};

export type Nota = {
  chave: string; // 44 dígitos
  numero: string;
  emissao: Date | null;
  fornecedor: { cnpj: string; nome: string };
  totalCents: number;
  itens: ItemNota[];
};

export type LeituraNota = { ok: true; nota: Nota } | { ok: false; erro: string };

const parser = new XMLParser({
  ignoreAttributes: false,
  // tudo como TEXTO: código de barras com zero à esquerda e número de 44
  // dígitos estragam se virarem número
  parseTagValue: false,
  removeNSPrefix: true,
  isArray: (nome) => nome === "det",
});

function centavos(v: unknown): number {
  const n = Number(String(v ?? "0"));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Só aceita código de barras de verdade (8, 12, 13 ou 14 dígitos) — a nota
 *  traz "SEM GTIN" quando o produto não tem. */
function eanValido(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return [8, 12, 13, 14].includes(d.length) ? d : null;
}

export function lerNfe(xml: string): LeituraNota {
  let raiz: Record<string, unknown>;
  try {
    raiz = parser.parse(xml);
  } catch {
    return { ok: false, erro: "O arquivo não é um XML válido." };
  }
  // o arquivo pode vir "embrulhado" com o protocolo (nfeProc) ou só a nota (NFe)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raiz as any;
  const inf = r?.nfeProc?.NFe?.infNFe ?? r?.NFe?.infNFe;
  if (!inf) {
    if (r?.cteProc || r?.CTe) return { ok: false, erro: "Este XML é de um conhecimento de transporte (CT-e), não de uma nota de mercadoria." };
    if (r?.CompNfse || r?.Nfse || r?.NFSe) return { ok: false, erro: "Este XML é de uma nota de serviço (NFS-e), não de uma nota de mercadoria." };
    return { ok: false, erro: "Este arquivo não é o XML de uma NF-e. Peça ao fornecedor o arquivo .xml da nota." };
  }

  const chave = (String(inf["@_Id"] ?? "").replace(/\D/g, "") || String(r?.nfeProc?.protNFe?.infProt?.chNFe ?? "").replace(/\D/g, ""));
  if (chave.length !== 44) return { ok: false, erro: "Não encontrei a chave de acesso da nota (44 dígitos) no arquivo." };

  const dets: unknown[] = inf.det ?? [];
  if (dets.length === 0) return { ok: false, erro: "A nota não tem nenhum item." };

  const itens: ItemNota[] = dets.map((d) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (d as any).prod ?? {};
    /* A nota descreve cada item de dois jeitos: o COMERCIAL (como foi
     * vendido: "2 CX") e o TRIBUTÁVEL (a unidade que vai pra prateleira: "24
     * UN", com o código de barras da unidade). Quando o tributável vem
     * preenchido, é ele que interessa pro estoque. A conferência deixa
     * corrigir a quantidade de qualquer jeito. */
    const qCom = Number(p.qCom ?? 0);
    const qTrib = Number(p.qTrib ?? 0);
    const usaTrib = Number.isFinite(qTrib) && qTrib > 0;
    const quantidade = Math.round(usaTrib ? qTrib : qCom);
    const formata = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace(".", ","));
    return {
      codigoFornecedor: String(p.cProd ?? "").trim(),
      descricao: String(p.xProd ?? "").trim(),
      ean: eanValido(p.cEANTrib) ?? eanValido(p.cEAN),
      quantidade: Number.isFinite(quantidade) ? quantidade : 0,
      unidade: String((usaTrib ? p.uTrib : p.uCom) ?? "UN").trim().toUpperCase().slice(0, 4) || "UN",
      totalCents: centavos(p.vProd),
      comoVeio: `${formata(qCom)} ${String(p.uCom ?? "").trim()}`.trim(),
    };
  });

  const emissaoTexto = String(inf.ide?.dhEmi ?? inf.ide?.dEmi ?? "");
  const emissao = emissaoTexto ? new Date(emissaoTexto) : null;

  return {
    ok: true,
    nota: {
      chave,
      numero: String(inf.ide?.nNF ?? "").trim(),
      emissao: emissao && !Number.isNaN(emissao.getTime()) ? emissao : null,
      fornecedor: {
        cnpj: String(inf.emit?.CNPJ ?? inf.emit?.CPF ?? "").replace(/\D/g, ""),
        nome: String(inf.emit?.xFant ?? inf.emit?.xNome ?? "Fornecedor").trim(),
      },
      totalCents: centavos(inf.total?.ICMSTot?.vNF),
      itens,
    },
  };
}

/** CNPJ com pontuação, pra mostrar. */
export function formatarCnpj(cnpj: string): string {
  return cnpj.length === 14 ? cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : cnpj;
}
