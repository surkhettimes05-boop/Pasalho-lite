const CACHE = "pasalho-offline-pos-v2";
const SHELL = ["/offline-pos.html", "/offline-pos.js"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("pasalho-offline-pos-") && key !== CACHE).map((key) => caches.delete(key)))),
  ]));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, response.clone())));
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    return cached || Response.error();
  }));
});
self.addEventListener("sync", (event) => {
  if (event.tag !== "pasalho-offline-pos") return;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) client.postMessage({ type: "OFFLINE_POS_SYNC" });
  }));
});
