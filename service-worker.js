// TPS Zeiterfassung – Service Worker
const CACHE = 'tps-ze-v1';
const OFFLINE_URLS = [
  '/zeiterfassung-tps/',
  '/zeiterfassung-tps/index.html'
];

// Install: Cache the shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(OFFLINE_URLS)).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: Network first, fall back to cache for navigation
self.addEventListener('fetch', e => {
  // Firebase und externe Ressourcen immer live laden
  if (e.request.url.includes('firebase') ||
      e.request.url.includes('gstatic') ||
      e.request.url.includes('googleapis')) {
    return;
  }

  // Nur GET-Requests cachen
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Nur valide Antworten cachen
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match('/zeiterfassung-tps/')))
  );
});
