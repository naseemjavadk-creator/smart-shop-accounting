// Smart Shop service worker: makes the app open and record entries with no internet.
// Pages: network first, fall back to the last copy. Static files: cache first.
// API calls are never cached here (entries are kept in IndexedDB by the app itself).
const VERSION = "v1";
const PAGES = `pages-${VERSION}`;
const STATIC = `static-${VERSION}`;
const WARM = ["/", "/entry", "/new/sale", "/new/purchase", "/new/expense", "/scan", "/outbox", "/inventory"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(PAGES).then((c) => Promise.all(WARM.map((u) => fetch(u, { credentials: "same-origin" }).then((r) => r.ok && !r.redirected && c.put(u, r)).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![PAGES, STATIC].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    e.respondWith(caches.open(STATIC).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) c.put(req, r.clone());
      return r;
    }));
    return;
  }

  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html") || req.headers.get("rsc")) {
    e.respondWith((async () => {
      const c = await caches.open(PAGES);
      try {
        const r = await fetch(req);
        if (r.ok && !r.redirected && req.mode === "navigate") c.put(url.pathname, r.clone());
        return r;
      } catch {
        const hit = (await c.match(url.pathname)) || (await c.match("/entry")) || (await c.match("/"));
        return hit || new Response("<h1>Offline</h1><p>Open the app once while online.</p>", { headers: { "Content-Type": "text/html" } });
      }
    })());
  }
});
