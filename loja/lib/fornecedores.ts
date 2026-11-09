import { prisma } from "./prisma";

/** Fornecedores já vinculados a um produto, e os demais (pra oferecer no
 *  select de "vincular fornecedor" — só nomes já cadastrados, nunca texto
 *  livre, pra não linkar errado por nome parecido). */
export async function fornecedoresDoProduto(produtoId: string) {
  const [vinculados, todos] = await Promise.all([
    prisma.produtoFornecedor.findMany({ where: { produtoId }, include: { fornecedor: true }, orderBy: { fornecedor: { nome: "asc" } } }),
    prisma.fornecedor.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);
  const vinculadosIds = new Set(vinculados.map((v) => v.fornecedorId));
  return {
    vinculados: vinculados.map((v) => ({ id: v.fornecedor.id, nome: v.fornecedor.nome })),
    disponiveis: todos.filter((f) => !vinculadosIds.has(f.id)),
  };
}
