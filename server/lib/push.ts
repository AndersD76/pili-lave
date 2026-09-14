/**
 * Avisos no celular (push).
 *
 * Por que importa: o cliente não fica olhando a tela do app enquanto espera.
 * Sem aviso, ele só descobre que a luz verde acendeu (ou que a lavagem
 * acabou) se abrir o app na hora certa. Com push, o celular avisa mesmo com
 * o app fechado.
 *
 * Nunca derruba o fluxo principal: se o envio falhar, a lavagem segue —
 * push é um extra, não um requisito.
 */
import webpush from "web-push";
import { prisma } from "./prisma";

/* Chaves VAPID: identificam este servidor para o navegador do cliente.
 * Em produção vêm do ambiente; o par abaixo é o de teste (fase atual). */
const PUBLICA =
  process.env.VAPID_PUBLIC_KEY ||
  "BL2R89IuQxjACRjxNyqHsolZ4dKOG6tA5zcPbvWHDgx0u_oo_AGFhargBu0lTWi9iYQ2DghbPdewjWCwfIOkA_M";
const PRIVADA =
  process.env.VAPID_PRIVATE_KEY || "nr-JIIRmJ6-3_jCYCbxH2atMInNTCAxAyNOLNBRXKNU";
const CONTATO = process.env.VAPID_SUBJECT || "mailto:contato@pililave.com.br";

let pronto = false;
function configurar() {
  if (pronto) return;
  webpush.setVapidDetails(CONTATO, PUBLICA, PRIVADA);
  pronto = true;
}

export function chavePublicaPush(): string {
  return PUBLICA;
}

export type Aviso = {
  titulo: string;
  corpo: string;
  /** para onde levar ao tocar no aviso */
  url?: string;
  /** avisos com a mesma tag se substituem — não empilha 5 "lavando" */
  tag?: string;
};

/** Envia para todos os aparelhos do cliente. Limpa inscrição morta. */
export async function avisarCliente(userId: string, aviso: Aviso): Promise<number> {
  try {
    configurar();
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    if (!subs.length) return 0;

    const carga = JSON.stringify({
      titulo: aviso.titulo,
      corpo: aviso.corpo,
      url: aviso.url ?? "/app",
      tag: aviso.tag ?? "pili",
    });

    let enviados = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            carga
          );
          enviados++;
          await prisma.pushSubscription.update({
            where: { id: s.id },
            data: { lastOkAt: new Date() },
          }).catch(() => {});
        } catch (e) {
          // 404/410 = o aparelho desinstalou ou revogou: tira da lista
          const status = (e as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410)
            await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        }
      })
    );
    return enviados;
  } catch (e) {
    console.error("push falhou:", e);
    return 0;   // push é extra: nunca quebra o fluxo da lavagem
  }
}

/** Avisa todos os admins (falha de máquina, câmera fora, internet caída). */
export async function avisarAdmins(aviso: Aviso): Promise<number> {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  const r = await Promise.all(admins.map((a) => avisarCliente(a.id, aviso)));
  return r.reduce((s, n) => s + n, 0);
}
