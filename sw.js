// Offline app shell. Bump VERSION on every release so devices pick up the update.
const VERSION = "aeg-invert-sheet-v1.2.0";
const SHELL = [
  "./", "index.html", "app.css", "app.js", "manifest.webmanifest",
  "vendor/jszip.min.js",
  "vendor/fonts/barlow-latin-400-normal.woff2", "vendor/fonts/barlow-latin-500-normal.woff2", "vendor/fonts/barlow-latin-600-normal.woff2",
  "vendor/fonts/barlow-condensed-latin-600-normal.woff2", "vendor/fonts/barlow-condensed-latin-700-normal.woff2",
  "vendor/fonts/ibm-plex-mono-latin-400-normal.woff2", "vendor/fonts/ibm-plex-mono-latin-500-normal.woff2",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-64.png", "brand/aeg-logo.png", "brand/aeg-mark.png"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => req.mode === "navigate" ? caches.match("index.html") : Response.error()))
  );
});
