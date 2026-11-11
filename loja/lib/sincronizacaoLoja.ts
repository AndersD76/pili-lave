import { registrarAtividade } from "./atividade";
import { gravarConfig, lerConfig, NUVEM_URL } from "./config";
import { buscarComandosNuvem, buscarRostosNuvem } from "./nuvem";
import { porta } from "./porta";
import { prisma } from "./prisma";
import { cadastrarRosto, removerRosto } from "./rosto";

/* O que este computador BUSCA na nuvem em segundo plano (instrumentation.ts)
 * pra a entrada e o totem funcionarem sem internet: a cópia dos clientes
 * (com o rosto indo direto pro serviço de reconhecimento) e as ordens do
 * dono (bloqueios e abertura remota da porta). */

/**
 * Traz os clientes que mudaram desde a última vez. A foto NÃO é gravada
 * aqui: vai direto pro serviço rosto/, que guarda só a assinatura. Se ele
 * estiver desligado, a marca de "até onde já trouxe" não avança — os dados
 * de entrada (nome, código) são atualizados mesmo assim e as fotos vêm de
 * novo na próxima rodada.
 */
export async function sincronizarRostos(): Promise<{ recebidos: number; pendenteRosto: boolean }> {
  const deviceKey = await lerConfig("deviceKey");
  if (!deviceKey) return { recebidos: 0, pendenteRosto: false };
  const desde = await lerConfig("rostosDesde");
  const clientes = await buscarRostosNuvem(NUVEM_URL, deviceKey, desde);
  if (!clientes || clientes.length === 0) return { recebidos: 0, pendenteRosto: false };

  let pendenteRosto = false;
  let maisNovo = desde ?? "";
  for (const c of clientes) {
    if (c.removido) {
      if (!(await removerRosto(c.userId))) pendenteRosto = true;
      await prisma.clienteLocal.deleteMany({ where: { nuvemUserId: c.userId } });
    } else {
      let temRosto: boolean | undefined;
      if (c.fotoBase64) {
        const r = await cadastrarRosto(c.userId, c.fotoBase64);
        if (r === "FORA_DO_AR") pendenteRosto = true;
        else temRosto = r === "OK";
      }
      const dados = { codigoCliente: String(c.codigoCliente), nome: c.nome, atualizadoEm: new Date() };
      // o código é único: se mudou de dono na nuvem, a linha antiga sai
      await prisma.clienteLocal.deleteMany({ where: { codigoCliente: dados.codigoCliente, NOT: { nuvemUserId: c.userId } } });
      await prisma.clienteLocal.upsert({
        where: { nuvemUserId: c.userId },
        update: { ...dados, ...(temRosto === undefined ? {} : { temRosto }) },
        create: { nuvemUserId: c.userId, ...dados, temRosto: temRosto ?? false },
      });
    }
    if (c.atualizadoEm > maisNovo) maisNovo = c.atualizadoEm;
  }
  if (!pendenteRosto && maisNovo) await gravarConfig({ rostosDesde: maisNovo });
  return { recebidos: clientes.length, pendenteRosto };
}

/** Bloqueios do dono, loja aberta/fechada e aberturas remotas da porta. */
export async function sincronizarComandos(): Promise<{ aberturas: number } | null> {
  const deviceKey = await lerConfig("deviceKey");
  if (!deviceKey) return null;
  const comandos = await buscarComandosNuvem(NUVEM_URL, deviceKey);
  if (!comandos) return null; // sem internet: vale o que já estava guardado

  const bloqueados = comandos.bloqueados.map((c) => c.replace(/\D/g, "")).filter(Boolean);
  await prisma.$transaction([
    prisma.clienteLocal.updateMany({ where: { bloqueado: true, codigoCliente: { notIn: bloqueados } }, data: { bloqueado: false } }),
    prisma.clienteLocal.updateMany({ where: { bloqueado: false, codigoCliente: { in: bloqueados } }, data: { bloqueado: true } }),
  ]);
  if (comandos.aberta !== undefined) await gravarConfig({ lojaAberta: comandos.aberta ? "1" : "0" });

  let aberturas = 0;
  for (const a of comandos.aberturasRemotas) {
    if (!a?.id || (await prisma.aberturaRemota.findUnique({ where: { id: String(a.id) } }))) continue;
    const pedidaPor = String(a.pedidaPor ?? "lojista");
    // grava ANTES de abrir: se o programa cair no meio, a mesma ordem não abre de novo
    await prisma.aberturaRemota.create({ data: { id: String(a.id), pedidaPor } });
    const r = await porta.abrir(`abertura remota pedida por ${pedidaPor}`);
    if (!r.ok) await prisma.aberturaRemota.update({ where: { id: String(a.id) }, data: { ok: false } });
    const lojista = await prisma.usuario.findFirst({ where: { papel: "LOJISTA", ativo: true } });
    if (lojista)
      await registrarAtividade(
        prisma, lojista, "PORTA_ABERTA",
        `Abertura remota pelo app, pedida por ${pedidaPor}${r.ok ? "" : ` — FALHOU: ${r.erro}`}`
      );
    aberturas++;
  }
  return { aberturas };
}
