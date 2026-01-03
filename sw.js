const CACHE_NAME = 'auntyacid-v32';

// Assets to cache on install
const PRECACHE_ASSETS = [
  '/index.html',
  '/app.js',
  '/main.css',
  '/manifest.webmanifest',
  '/aunytacidlogo.png',
  '/favicon-48x48.png',
  '/manifest-icon-192.maskable.png',
  '/manifest-icon-512.maskable.png'
];

// Install event - cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean old caches and take control immediately
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
  
  // Skip cross-origin requests entirely
  if (url.origin !== self.location.origin) {
    return;
  }
  
  // Handle navigation requests OR root path requests - serve index.html
  const isNavigation = event.request.mode === 'navigate';
  const isRootPath = url.pathname === '/' || url.pathname === '';
  
  if (isNavigation || isRootPath) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        
        // Try cache first for fast startup
        const cachedResponse = await cache.match('/index.html');
        
        // Fetch fresh in background (or foreground if no cache)
        const fetchPromise = fetch('/index.html').then(response => {
          if (response && response.ok) {
            cache.put('/index.html', response.clone());
          }
          return response;
        }).catch(() => null);
        
        if (cachedResponse) {
          // Return cached immediately, update in background
          fetchPromise; // fire and forget
          return cachedResponse;
        }
        
        // No cache, wait for network
        const networkResponse = await fetchPromise;
        if (networkResponse) {
          return networkResponse;
        }
        
        // Everything failed
        return new Response('Offline - please check your connection', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        });
      })()
    );
    return;
  }
  
  // For other same-origin requests: stale-while-revalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(event.request);
      
      // Start network fetch
      const fetchPromise = fetch(event.request).then(response => {
        if (response && response.ok) {
          cache.put(event.request, response.clone());
        }
        return response;
      }).catch(() => null);
      
      if (cachedResponse) {
        return cachedResponse;
      }
      
      const networkResponse = await fetchPromise;
      if (networkResponse) {
        return networkResponse;
      }
      
      throw new Error('No cached or network response available');
    })()
  );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});