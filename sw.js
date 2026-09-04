// The version of your cache. 
// Change this number (e.g., to 'meena-chits-v2') whenever you update your HTML/JS files!
const CACHE_NAME = 'meena-chits-v1';

// The essential files your app needs to load offline
// FIXED: Using relative paths (./) prevents 404 installation crashes on local servers and subdirectories
const ASSETS_TO_CACHE = [
  './',
  './login.html',
  './home.html',
  './add.html',
  './groups.html',
  './payment.html',
  './reports.html',
  './auction.html',
  './config.js',
  './manifest.json'
];

// 1. INSTALL EVENT: Caches the app shell
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Forces the waiting service worker to become the active service worker
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Opened cache and caching assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).catch(err => {
      console.error('Failed to cache assets during install:', err);
    })
  );
});

// 2. ACTIVATE EVENT: Cleans up old caches when you update the app
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim(); // Take control of all open pages immediately
});

// 3. FETCH EVENT: Network-First strategy (Crucial for financial apps)
self.addEventListener('fetch', (event) => {
  // We only want to handle GET requests (Firebase handles its own POST/database syncing)
  if (event.request.method !== 'GET') return;
  
  // FIXED: Do not attempt to cache Chrome extensions or external Firebase API sockets
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // If the network is working, save a fresh copy to the cache and return the response
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // If the network is down (offline), serve the file from the cache
        return caches.match(event.request);
      })
  );
});
