// TPS Zeiterfassung – Service Worker v47
// Strategie: netzwerk-first für frische Versionen, Antworten werden aber gecacht,
// damit bei Netzwerk-Aussetzern die letzte gute Version statt "rohem HTML" kommt.
// KEIN automatisches Neuladen offener Tabs mehr (verursachte stoerendes Aufblitzen).
const CACHE = 'tps-ze-v165';

const SDK_URLS = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage-compat.js',
];

// Install: Nur Firebase-SDK cachen, sofort aktivieren
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(SDK_URLS.map(url =>
        c.add(new Request(url, { cache: 'reload' })).catch(() => {})
      ))
    ).then(() => self.skipWaiting())
  );
});

// Activate: Alte Caches löschen + Kontrolle übernehmen.
// (KEIN c.navigate() mehr – offene Tabs werden NICHT zwangsweise neu geladen.)
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Firebase API-Aufrufe nie intercepten
  if (url.includes('firebaseio.com') ||
      url.includes('identitytoolkit') ||
      url.includes('securetoken.google')) {
    return;
  }

  if (e.request.method !== 'GET') return;

  // Firebase SDK: Cache-first (versionierte CDN-URLs, ändern sich nie)
  if (SDK_URLS.some(u => url.startsWith(u))) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }))
    );
    return;
  }

  // Alle App-Dateien (HTML/JS/CSS): netzwerk-first für frische Versionen, ABER
  // erfolgreiche Antworten cachen. Bei Netzwerk-Aussetzern wird die letzte gute
  // Version geliefert statt ungestyltem "rohem HTML" (fehlgeschlagenes CSS).
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request)) // Offline-/Aussetzer-Fallback
  );
});
