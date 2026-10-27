// Service Worker: Die App-Dateien kommen sofort aus dem Gerät (schneller Start).
// Neu geladen wird nur, wenn es eine neue Version gibt: app.js vergleicht version.json,
// leert dann diesen Speicher und lädt neu – dann holt der Service Worker alles frisch.
// Trainingsdaten werden NICHT gespeichert – Anfragen an Supabase laufen am Service Worker vorbei.
const CACHE = 'athletik-v24';
const ASSETS = [
  './', './index.html', './styles.css', './config.js', './auth.js', './demo.js', './ui.js', './player.js', './pdfview.js', './admin.js', './app.js',
  './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/logo-skfb.png',
];
const NETWORK_TIMEOUT_MS = 8000;

// Frisch vom Server holen – der Zufalls-Parameter umgeht den Zwischenspeicher von GitHub (bis 10 Min. alt)
function fresh(path) {
  return Promise.race([
    fetch(`${path}${path.includes('?') ? '&' : '?'}_=${Date.now()}`, { cache: 'no-store' }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
  ]);
}
const keyOf = (url) => new URL(url, self.registration.scope).pathname.replace(/\/$/, '/index.html');

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async (a) => {
      const res = await fresh(new URL(a, self.registration.scope).pathname);
      if (res.ok) await cache.put(keyOf(a), res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== 'athletik-pdf').map((k) => caches.delete(k))))
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
    const key = req.mode === 'navigate' ? keyOf('./index.html') : url.pathname;
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fresh(url.pathname);
      if (res.ok) cache.put(key, res.clone());
      return res;
    } catch {
      return Response.error();
    }
  })());
});
