// TPS Zeiterfassung – Service Worker v3 (Offline-Support)
const CACHE = 'tps-ze-v3';
const APP_SHELL = [
  '/zeiterfassung-tps/',
  '/zeiterfassung-tps/index.html',
  '/zeiterfassung-tps/manifest.json',
];
const SDK_URLS = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
];

// Install: App-Shell + Firebase-SDK cachen
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(
        [...APP_SHELL, ...SDK_URLS].map(url =>
          c.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// Activate: Alte Caches löschen
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch-Strategie:
// - Firebase Realtime DB API → immer Netz (nie cachen)
// - Firebase SDK JS-Dateien → Cache first (schon gecacht im Install)
// - App-Shell → Network first mit Cache-Fallback
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Firebase Realtime DB / Auth API → nicht intercepten
  if (url.includes('firebaseio.com') ||
      url.includes('identitytoolkit') ||
      url.includes('securetoken.google')) {
    return;
  }

  // Nur GET cachen
  if (e.request.method !== 'GET') return;

  // Firebase SDK + App-Shell: Cache first, dann Netz
  if (SDK_URLS.some(u => url.startsWith(u)) || url.includes('/zeiterfassung-tps')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => caches.match('/zeiterfassung-tps/'));
      })
    );
    return;
  }

  // Alle anderen: Network first, Cache fallback
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
