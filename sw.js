/* MechHub service worker
 * - Pre-caches only the app shell (home page, manifest, icons).
 * - Home page: network-first (always fresh when online, cached copy only as an offline fallback).
 * - Icons/manifest: stale-while-revalidate.
 * - Never touches anything else: Google Drive, the course sites and any other URL go straight to the network.
 * To force an update of cached files, bump VERSION below.
 */
'use strict';

const VERSION = 'v1';
const CACHE = 'mechhub-' + VERSION;
const SCOPE = self.registration.scope;                 // e.g. https://user.github.io/repo/
const abs = (p) => new URL(p, SCOPE).href;

const SHELL = [abs('./'), abs('index.html')];
const ASSETS = [
  abs('manifest.webmanifest'),
  abs('icons/icon-192.png'),
  abs('icons/icon-512.png'),
  abs('icons/icon-maskable-192.png'),
  abs('icons/icon-maskable-512.png'),
  abs('icons/apple-touch-icon.png')
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(SHELL.concat(ASSETS).map((url) =>
        fetch(new Request(url, { cache: 'reload' })).then((res) => {
          if (!res.ok) throw new Error('Precache failed: ' + url + ' (' + res.status + ')');
          return cache.put(url, res);
        })
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.indexOf('mechhub-') === 0 && k !== CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(request, key) {
  return caches.open(CACHE).then((cache) => {
    const network = fetch(request, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { cache.put(key, res.clone()); return res; }
      if (res.status >= 500) throw new Error('Server error');
      return res;
    });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS));
    return Promise.race([network, timeout]).catch(() =>
      cache.match(key)
        .then((hit) => hit || cache.match(SHELL[0]))
        .then((hit) => hit || cache.match(SHELL[1]))
        .then((hit) => hit || network)
    );
  });
}

function staleWhileRevalidate(event, request, key) {
  return caches.open(CACHE).then((cache) =>
    cache.match(key).then((hit) => {
      const refresh = fetch(request).then((res) => {
        if (res.ok) cache.put(key, res.clone());
        return res;
      });
      if (!hit) return refresh;
      event.waitUntil(refresh.catch(() => {}));       // background update; offline failures are harmless
      return hit;
    })
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;     // external links: never intercepted
  const key = url.origin + url.pathname;

  if (request.mode === 'navigate') {
    if (SHELL.indexOf(key) === -1) return;             // only MechHub's own home page
    event.respondWith(networkFirst(request, key));
  } else if (ASSETS.indexOf(key) !== -1) {
    event.respondWith(staleWhileRevalidate(event, request, key));
  }
});
