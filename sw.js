// Service Worker: holt die App immer frisch aus dem Netz (damit Updates sofort ankommen)
// und fällt nur ohne Netz auf die gespeicherte Kopie zurück.
// Trainingsdaten werden NICHT gespeichert – Anfragen an Supabase laufen am Service Worker vorbei.
const CACHE = 'athletik-v20';
const ASSETS = [
  './', './index.html', './styles.css', './config.js', './auth.js', './demo.js', './ui.js', './player.js', './pdfview.js', './admin.js', './app.js',
  './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/logo-skfb.png',
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/version.json')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = req.mode === 'navigate' ? './index.html' : url.pathname;
    let res = null;
    try {
      res = await Promise.race([
        // Zufalls-Parameter umgeht den Zwischenspeicher von GitHub (bis 10 Min.) – Updates kommen sofort an
        fetch(`${url.origin}${url.pathname}?_=${Date.now()}`, { cache: 'no-store' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
      ]);
      if (res.ok) {
        cache.put(key, res.clone());
        return res;
      }
    } catch {
      // offline oder zu langsam → gespeicherte Kopie
    }
    const cached = await cache.match(key, { ignoreSearch: true });
    return cached || res || Response.error();
  })());
});
