// -----------------------------------------------------------------------
// sw-template.js — Polecat Shell network-first service worker (TEMPLATE).
//
// This file is a TEMPLATE, not an ES module — service workers are classic
// scripts, so it is the one shell file you copy rather than import. To adopt:
//
//   1. COPY it to your app root:  cp vendor/polecat-shell/sw-template.js sw.js
//   2. Set CACHE_VERSION below to your app's cache name (replace the
//      '__APP__' placeholder, e.g. 'jt-shell-v1').
//   3. BUMP CACHE_VERSION in the SAME COMMIT as every shell adoption or
//      major change — the activate handler purges every cache that doesn't
//      match the current name, and that purge is what stops returning users
//      from seeing the old UI.
//
// Strategy is network-first, cache-as-fallback: every same-origin GET always
// tries the network first and refreshes the cache with whatever comes back,
// so an online visit is NEVER served stale JS after a deploy (fleet apps
// ship builds often). The cache only kicks in when the network is
// unavailable, which is exactly what "installable / offline-capable" needs.
// -----------------------------------------------------------------------
const CACHE_VERSION = '__APP__-shell-v1';

self.addEventListener('install', (e) => {
  // Take over immediately — waiting would keep the previous worker (and its
  // idea of the cache name) alive until every tab closes.
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Purge every cache that isn't the current version. This is the
    // mechanism behind the "bump CACHE_VERSION on every shell adoption"
    // rule: old caches (old shell UI) die here on the first visit.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      // Offline navigation to an uncached URL: fall back to the app shell
      // (the scope root this worker was registered with, cached on any
      // earlier online visit).
      if (req.mode === 'navigate') {
        const shell = await caches.match(self.registration.scope);
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
