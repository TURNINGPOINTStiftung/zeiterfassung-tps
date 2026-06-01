// TPS Zeiterfassung – Service Worker v20
// Strategie: NUR Firebase-SDK cachen; alle App-Dateien IMMER frisch (no-store).
// no-store umgeht Browser-HTTP-Cache UND zwingt frische Versionen nach Deploy.
const CACHE = 'tps-ze-v20';

const SDK_URLS = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
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

// Activate: Alte Caches löschen + alle offenen Tabs neu laden
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() =>
        self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
          .then(clients => clients.forEach(c => c.navigate(c.url)))
      )
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

  // Alle App-Dateien (HTML/JS/CSS): IMMER frisch, Browser-Cache umgehen.
  // cache:'no-store' zwingt einen echten Netzwerk-Request – keine veralteten Module mehr.
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .catch(() => caches.match(e.request)) // Offline-Fallback
  );
});
