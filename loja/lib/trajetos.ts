import { criarAlerta } from "./alertas";
import { prisma } from "./prisma";

/* Trajeto de quem pode ter levado um item sem pagar. Quando o fechamento do
 * período dá FALTA (saiu mais da prateleira do que foi pago), a divergência
 * guarda os "suspeitos" (lib/visao.ts). O programa das câmeras (visao/)
 * pergunta aqui o que há pra montar, compila o percurso de cada um (mapa +
 * fotos) e devolve; cada trajeto recebido vira um aviso pro dono.
 *
 * É material pra o dono CONFERIR — não é acusação nem gera cobrança. */

export type Suspeito = { visitaId: string; nome: string; codigoCliente?: string | null };
export type TrajetoRecebido = { visitaId: string; nome: string; resumo: string; imagens: string[]; recebidoEm: string };

/** Depois disso a loja para de pedir: as câmeras já apagaram ou nunca tiveram o registro. */
const VALIDADE_PEDIDO_MS = 48 * 60 * 60 * 1000;
const MAX_IMAGENS = 3;

function lerJson<T>(json: string): T[] {
  try {
    const lista: unknown = JSON.parse(json);
    return Array.isArray(lista) ? (lista as T[]) : [];
  } catch {
    return [];
  }
}

export const lerSuspeitos = (json: string) => lerJson<Suspeito>(json);
export const lerTrajetos = (json: string) => lerJson<TrajetoRecebido>(json);

/** O que as câmeras ainda precisam montar: um item por suspeito sem trajeto. */
export async function pedidosDeTrajeto() {
  const divergencias = await prisma.divergencia.findMany({
    where: { criadaEm: { gte: new Date(Date.now() - VALIDADE_PEDIDO_MS) }, NOT: { suspeitos: "[]" } },
    orderBy: { criadaEm: "asc" }, take: 20,
  });
  const pedidos: { divergenciaId: string; visitaId: string; nome: string; inicio: string; fim: string }[] = [];
  for (const d of divergencias) {
    const prontos = new Set(lerTrajetos(d.trajetos).map((t) => t.visitaId));
    const faltam = lerSuspeitos(d.suspeitos).filter((s) => !prontos.has(s.visitaId));
    if (faltam.length === 0) continue;
    const visitas = await prisma.visita.findMany({ where: { id: { in: faltam.map((s) => s.visitaId) } } });
    for (const s of faltam) {
      const v = visitas.find((x) => x.id === s.visitaId);
      pedidos.push({
        divergenciaId: d.id, visitaId: s.visitaId, nome: s.nome,
        inicio: (v?.entrouEm ?? d.inicio).toISOString(), fim: (v?.saiuEm ?? d.fim).toISOString(),
      });
    }
  }
  return pedidos;
}

/** As câmeras devolveram o trajeto de um suspeito: guarda na divergência e avisa o dono. */
export async function registrarTrajeto(dados: { divergenciaId: string; visitaId: string; resumo: string; imagens: string[] }) {
  return prisma.$transaction(async (tx) => {
    const d = await tx.divergencia.findUnique({ where: { id: dados.divergenciaId } });
    if (!d) return { ok: false as const, erro: "Divergência não encontrada." };
    const suspeito = lerSuspeitos(d.suspeitos).find((s) => s.visitaId === dados.visitaId);
    if (!suspeito) return { ok: false as const, erro: "Essa visita não está entre as pedidas." };
    const trajetos = lerTrajetos(d.trajetos);
    if (trajetos.some((t) => t.visitaId === dados.visitaId)) return { ok: true as const, repetido: true };

    const imagens = dados.imagens.slice(0, MAX_IMAGENS);
    trajetos.push({ visitaId: suspeito.visitaId, nome: suspeito.nome, resumo: dados.resumo, imagens, recebidoEm: new Date().toISOString() });
    await tx.divergencia.update({ where: { id: d.id }, data: { trajetos: JSON.stringify(trajetos) } });

    const falta = d.saiuPrateleira - d.pago;
    const quem = suspeito.codigoCliente ? `${suspeito.nome} (código ${suspeito.codigoCliente})` : suspeito.nome;
    await criarAlerta(tx, {
      tipo: "DIVERGENCIA",
      titulo: `Trajeto de ${suspeito.nome} na loja`,
      detalhe:
        `${falta === 1 ? "Faltou 1 item" : `Faltaram ${falta} itens`} no período em que ${quem} esteve na loja. ${dados.resumo} ` +
        "Confira as imagens antes de qualquer conclusão: nenhuma cobrança é feita sozinha.",
      imagens, ocorridoEm: d.fim,
    });
    return { ok: true as const, repetido: false };
  });
}
