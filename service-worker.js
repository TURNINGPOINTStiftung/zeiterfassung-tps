// TPS Zeiterfassung – Service Worker v49
// Strategie: netzwerk-first für frische Versionen, Antworten werden aber gecacht,
// damit bei Netzwerk-Aussetzern die letzte gute Version statt "rohem HTML" kommt.
// KEIN automatisches Neuladen offener Tabs mehr (verursachte stoerendes Aufblitzen).
const CACHE = 'tps-ze-v339';

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

  // Manifest NIE aus dem Cache liefern → Änderungen (z. B. Orientierung) kommen
  // sofort frisch an; sonst installiert Chrome die PWA mit dem alten Manifest.
  if (url.includes('/manifest.json')) return;

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

  // Alle App-Dateien (HTML/JS/CSS): STALE-WHILE-REVALIDATE.
  // Sofort aus dem Cache liefern → Neuladen ist quasi instant. Parallel im
  // Hintergrund die frische Version holen und für das naechste Mal cachen.
  // Neue Deploys kommen so spaetestens beim naechsten Neuladen an; zusaetzlich
  // leert der CACHE-Namenswechsel pro Version den alten Cache (activate).
  // Offline / Netzaussetzer → letzte gute Version aus dem Cache.
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const network = fetch(e.request)
          .then(res => {
            if (res && res.status === 200 && res.type === 'basic') cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;   // Cache sofort; wenn nicht vorhanden, aufs Netz warten
      })
    )
  );
});
