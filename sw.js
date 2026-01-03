const CACHE_NAME = 'auntyacid-v31';

// Assets to cache on install (use absolute paths from root)
// Note: Don't include '/' as it redirects to /index.html on most hosts
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
  
  // Skip cross-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }
  
  // Handle navigation requests (HTML pages) - always serve index.html for SPA
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        
        try {
          // Fetch index.html directly (not the navigation URL which may redirect)
          const networkResponse = await fetch('/index.html', { redirect: 'follow' });
          if (networkResponse && networkResponse.ok) {
            // Cache the fresh response
            cache.put('/index.html', networkResponse.clone());
            return networkResponse;
          }
        } catch (e) {
          // Network failed, fall through to cache
        }
        
        // Network failed or returned error - serve from cache
        const cachedResponse = await cache.match('/index.html');
        if (cachedResponse) {
          return cachedResponse;
        }
        
        // Last resort: try fetching again
        return fetch('/index.html');
      })()
    );
    return;
  }
  
  // For other same-origin requests: stale-while-revalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(event.request);
      
      // Start network fetch in background
      const fetchPromise = fetch(event.request).then(response => {
        if (response && response.ok) {
          cache.put(event.request, response.clone());
        }
        return response;
      }).catch(() => null);
      
      if (cachedResponse) {
        // Return cached, update in background
        return cachedResponse;
      }
      
      // Nothing cached, wait for network
      const networkResponse = await fetchPromise;
      if (networkResponse) {
        return networkResponse;
      }
      
      // Both failed
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