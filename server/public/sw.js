/* PILI CLEAN — service worker.
   Sem cache agressivo de propósito: pagamento e voucher precisam estar frescos.
   Também recebe os avisos (push) da nuvem e abre o app ao tocar. */
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

/* Aviso chegando: mostra na tela do celular mesmo com o app fechado. */
self.addEventListener("push", (e) => {
  let d = { titulo: "PILI CLEAN", corpo: "", url: "/app", tag: "pili" };
  try { d = { ...d, ...e.data.json() }; } catch { /* payload vazio: usa o padrão */ }
  e.waitUntil(
    self.registration.showNotification(d.titulo, {
      body: d.corpo,
      tag: d.tag,              // mesma tag substitui o aviso anterior
      renotify: true,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: d.url },
    })
  );
});

/* Tocou no aviso: traz a aba aberta para a frente, ou abre uma nova. */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const alvo = e.notification.data?.url || "/app";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((abas) => {
      for (const aba of abas) {
        if (aba.url.includes("/app") && "focus" in aba) { aba.navigate(alvo); return aba.focus(); }
      }
      return self.clients.openWindow(alvo);
    })
  );
});
