// meena-sw.js

const CACHE_VERSION = 2;
const STATIC_CACHE = `meena-static-v${CACHE_VERSION}`;
const DYNAMIC_CACHE = `meena-dynamic-v${CACHE_VERSION}`;
const MAX_DYNAMIC_ITEMS = 50; // Prevents the dynamic cache from bloating the user's device

// The essential files your app needs to load offline
const ASSETS_TO_CACHE = [
  './',
  './login.html',
  './home.html',
  './add.html',
  './groups.html',
  './payment.html',
  './reports.html',
  './auction.html',
  './aiBot.html', // Added AI Bot to offline shell
  './config.js',
  './manifest.json'
];

// Utility: Enforce a size limit on the dynamic cache
const limitCacheSize = (name, size) => {
  caches.open(name).then(cache => {
    cache.keys().then(keys => {
      if (keys.length > size) {
        // Delete the oldest item (first in the array) and recursively check again
        cache.delete(keys[0]).then(() => limitCacheSize(name, size));
      }
    });
  });
};

// 1. INSTALL EVENT: Pre-cache the application shell
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Pre-caching offline shell');
      return cache.addAll(ASSETS_TO_CACHE);
    }).catch(err => console.error('[SW] Cache install error:', err))
  );
});

// 2. ACTIVATE EVENT: Clean up old caches and enable Navigation Preload
self.addEventListener('activate', (event) => {
  event.waitUntil(async function() {
    // Enable Navigation Preload if supported by the browser
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    
    // Clear out any old cache versions
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map((cacheName) => {
        if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
          console.log('[SW] Deleting old cache:', cacheName);
          return caches.delete(cacheName);
        }
      })
    );
  }());
  self.clients.claim();
});

// 3. FETCH EVENT: Network-First with Timeout (Crucial for mobile networks)
self.addEventListener('fetch', (event) => {
  // Ignore non-GET requests (POST, PUT, DELETE should bypass SW)
  if (event.request.method !== 'GET') return;
  
  // Ignore Chrome extensions, localized blobs, or external API sockets
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(async function() {
    try {
      // 1. Check for Navigation Preload response first
      const preloadResponse = await event.preloadResponse;
      if (preloadResponse) {
        return preloadResponse;
      }

      // 2. Setup a 3-second network timeout 
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      // 3. Attempt to fetch from the network
      const networkResponse = await fetch(event.request, { signal: controller.signal });
      clearTimeout(timeoutId); // Clear timeout if network responds in time

      // If the response is valid, clone it into the DYNAMIC cache for future offline use
      if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
        const cache = await caches.open(DYNAMIC_CACHE);
        cache.put(event.request, networkResponse.clone());
        limitCacheSize(DYNAMIC_CACHE, MAX_DYNAMIC_ITEMS); // Keep storage clean
      }
      
      return networkResponse;
      
    } catch (error) {
      // 4. Fallback to Cache if the network fails or times out (> 3 seconds)
      console.log(`[SW] Network failed/timed out for ${event.request.url}. Serving from cache.`);
      const cachedResponse = await caches.match(event.request);
      
      if (cachedResponse) {
        return cachedResponse;
      }

      // Optional: If the request is for an HTML page and it's not in cache, you could return a custom offline page here
      if (event.request.headers.get('accept').includes('text/html')) {
        return caches.match('./'); // Fallback to root/index if specific page fails
      }
      
      throw error;
    }
  }());
});
