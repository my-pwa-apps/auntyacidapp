const CACHE_NAME = 'auntyacid-v28';

// Assets to cache on install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './main.css',
  './manifest.webmanifest',
  './aunytacidlogo.png',
  './favicon-48x48.png',
  './manifest-icon-192.maskable.png',
  './manifest-icon-512.maskable.png'
];

// Install event - cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip cross-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }
  
  // Handle navigation requests (HTML pages) - always serve index.html for SPA
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html')
        .then(cachedResponse => {
          if (cachedResponse) {
            // Update cache in background
            event.waitUntil(
              fetch('./index.html')
                .then(response => {
                  if (response && response.status === 200) {
                    caches.open(CACHE_NAME)
                      .then(cache => cache.put('./index.html', response));
                  }
                })
                .catch(() => {})
            );
            return cachedResponse;
          }
          return fetch('./index.html');
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Return cached version and update cache in background
          event.waitUntil(
            fetch(event.request)
              .then(response => {
                if (response && response.status === 200) {
                  const responseClone = response.clone();
                  caches.open(CACHE_NAME)
                    .then(cache => cache.put(event.request, responseClone));
                }
              })
              .catch(() => {})
          );
          return cachedResponse;
        }
        
        // Not in cache - fetch from network
        return fetch(event.request)
          .then(response => {
            if (!response || response.status !== 200) {
              return response;
            }
            
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, responseClone));
            
            return response;
          });
      })
  );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});