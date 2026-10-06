/* ExecuFlow service worker — offline app shell.
   RELEASE RULE: bump VERSION on every release. A new VERSION creates a new cache,
   re-downloads every file in ASSETS and removes the old cache on activation. */
const VERSION = '1.0.1';
const CACHE = `execuflow-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './chart.umd.js',
  './manifest.webmanifest',
  './favicon.ico',
  './privacy.html',
  './icon-32.png',
  './icon-48.png',
  './icon-96.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('execuflow-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page asks for this after the user clicks "Restart now" in the update toast.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: a cached page (index.html, privacy.html) is served directly;
  // the app's own address gets the cached shell (instant + offline); anything
  // else goes to the network and falls back to the shell only when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => {
        if (hit) return hit;
        const path = url.pathname;
        if (path.endsWith('/') || path.endsWith('/index.html')) {
          return caches.match('./index.html').then((shell) => shell || fetch(req));
        }
        return fetch(req).catch(() => caches.match('./index.html'));
      })
    );
    return;
  }

  // Everything else: cache first, then network (and remember what we fetched).
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    }))
  );
});
