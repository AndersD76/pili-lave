/* PILI LAVE — service worker mínimo (instalabilidade + passthrough).
   Sem cache agressivo de propósito: pagamento e voucher precisam estar frescos. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  e.respondWith(fetch(e.request).catch(() =>
    new Response("Sem conexão. Abra novamente quando a internet voltar.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  ));
});
