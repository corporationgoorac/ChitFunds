// meena-sw.js

const CACHE_VERSION = 2;
const STATIC_CACHE = `meena-static-v${CACHE_VERSION}`;
const DYNAMIC_CACHE = `meena-dynamic-v${CACHE_VERSION}`;
const MAX_DYNAMIC_ITEMS = 60;

// Essential app shell files
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './login.html',
  './home.html',
  './add.html',
  './groups.html',
  './payment.html',
  './reports.html',
  './auction.html',
  './aiBot.html',
  './config.js',
  './manifest.json'
];

// Utility: Enforce a size limit on the dynamic cache
const limitCacheSize = async (name, size) => {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > size) {
    await cache.delete(keys[0]);
    await limitCacheSize(name, size);
  }
};

// 1. INSTALL EVENT: Pre-cache the application shell Resiliently
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      console.log('[SW] Pre-caching offline shell');
      // Cache files individually so one missing file (like index.html) doesn't abort the whole install
      await Promise.allSettled(
        ASSETS_TO_CACHE.map(url => cache.add(url).catch(err => console.warn(`[SW] Skipped ${url}:`, err)))
      );
    })
  );
});

// 2. ACTIVATE EVENT: Clean up old caches and enable Navigation Preload
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map((cacheName) => {
        if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
          console.log('[SW] Deleting old cache:', cacheName);
          return caches.delete(cacheName);
        }
      })
    );
    await self.clients.claim();
  })());
});

// 3. FETCH EVENT: Smart Routing (Cache-First for Fonts/CDNs, Network-First with Timeout for App)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);

  // A. CACHE-FIRST STRATEGY: Google Fonts & External CDNs (Three.js, Marked.js)
  // Ensures icons and libraries load in 0ms on reload without network delay
  const isFontOrCDN = 
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('cdn.jsdelivr.net');

  if (isFontOrCDN) {
    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200) {
          const cache = await caches.open(DYNAMIC_CACHE);
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        return cached;
      }
    })());
    return;
  }

  // B. NETWORK-FIRST WITH 3s TIMEOUT: HTML Pages & App Logic
  event.respondWith((async () => {
    try {
      const preloadResponse = await event.preloadResponse;
      if (preloadResponse) return preloadResponse;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const networkResponse = await fetch(event.request, { signal: controller.signal });
      clearTimeout(timeoutId);

      // Allow both 'basic' (same-origin) and 'cors' valid responses
      if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
        const cache = await caches.open(DYNAMIC_CACHE);
        cache.put(event.request, networkResponse.clone());
        limitCacheSize(DYNAMIC_CACHE, MAX_DYNAMIC_ITEMS);
      }
      
      return networkResponse;
      
    } catch (error) {
      // Fallback to Cache (ignoring ?mode=voice or other query params)
      const cachedResponse = await caches.match(event.request, { ignoreSearch: true });
      if (cachedResponse) return cachedResponse;

      const acceptHeader = event.request.headers.get('accept') || '';
      if (acceptHeader.includes('text/html')) {
        return caches.match('./');
      }
      
      throw error;
    }
  })());
});
