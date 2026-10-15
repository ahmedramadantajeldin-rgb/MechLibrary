/* MechHub service worker  — v4
 * Cache strategy:
 *   Shell (home page):          network-first with 4 s timeout → cached fallback.
 *   Static assets (icons etc.): stale-while-revalidate (served instantly, refreshed in background).
 *   Everything else (external course sites, Drive, etc.): never intercepted.
 *
 * To force browsers to pick up a new version of cached files, bump VERSION.
 */
'use strict';

const VERSION = 'v4';   // v4: manifest name/screenshots fix (precache a fresh manifest)
const CACHE   = 'mechhub-' + VERSION;
const SCOPE   = self.registration.scope;          // e.g. https://user.github.io/MechLibrary/
const abs     = (p) => new URL(p, SCOPE).href;

// App-shell pages (network-first)
const SHELL = [abs('./'), abs('index.html')];

// Static assets (stale-while-revalidate)
const ASSETS = [
  abs('manifest.webmanifest'),
  abs('favicon.ico'),
  abs('icons/favicon.svg'),
  abs('icons/favicon-32.png'),
  abs('icons/android-chrome-192.png'),
  abs('icons/android-chrome-512.png'),
  abs('icons/android-chrome-maskable-192.png'),
  abs('icons/android-chrome-maskable-512.png'),
  abs('icons/apple-touch-icon-180.png')
];

const NETWORK_TIMEOUT_MS = 4000;

// ── Install: pre-cache shell + assets ──────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(
        SHELL.concat(ASSETS).map((url) =>
          fetch(new Request(url, { cache: 'reload' }))
            .then((res) => {
              if (!res.ok) throw new Error('Precache failed: ' + url + ' (' + res.status + ')');
              return cache.put(url, res);
            })
            .catch((err) => console.warn('[SW] Precache skipped:', url, err.message))
        )
      ))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: delete stale caches from previous versions ───────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('mechhub-') && k !== CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Network-first (shell pages) ────────────────────────────────────────────
function networkFirst(request, key) {
  return caches.open(CACHE).then((cache) => {
    const network = fetch(request, { cache: 'no-cache' }).then((res) => {
      if (res.ok)           { cache.put(key, res.clone()); return res; }
      if (res.status >= 500) throw new Error('Server error');
      return res;
    });
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)
    );
    return Promise.race([network, timeout]).catch(() =>
      cache.match(key)
        .then((hit) => hit || cache.match(SHELL[0]))
        .then((hit) => hit || cache.match(SHELL[1]))
        .then((hit) => hit || network)         // last resort: retry network
    );
  });
}

// ── Stale-while-revalidate (static assets) ─────────────────────────────────
function staleWhileRevalidate(event, request, key) {
  return caches.open(CACHE).then((cache) =>
    cache.match(key).then((hit) => {
      const refresh = fetch(request).then((res) => {
        if (res.ok) cache.put(key, res.clone());
        return res;
      });
      if (!hit) return refresh;
      event.waitUntil(refresh.catch(() => {}));   // background revalidation; failures are harmless
      return hit;
    })
  );
}

// ── Fetch handler ──────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only handle same-origin requests; let external URLs (Drive, course sites) go straight to network
  if (url.origin !== self.location.origin) return;

  const key = url.origin + url.pathname;

  if (request.mode === 'navigate') {
    // Only intercept MechHub's own home page; don't touch course subpaths on this origin
    if (!SHELL.includes(key)) return;
    event.respondWith(networkFirst(request, key));
  } else if (ASSETS.includes(key)) {
    event.respondWith(staleWhileRevalidate(event, request, key));
  }
});
