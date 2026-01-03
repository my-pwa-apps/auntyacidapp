const CACHE_NAME = 'auntyacid-v33';

// Assets to cache on install (use ./ relative paths like GarfieldApp/DirkJanApp)
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

// Cache size limits
const MAX_RUNTIME_CACHE_SIZE = 30;
const MAX_IMAGE_CACHE_SIZE = 50;

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
        keys.filter(key => key.startsWith('auntyacid-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Cache-first strategy for app shell
async function cacheFirstStrategy(request, cacheName) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // If fetch fails and it's an HTML request, return cached index.html
    if (request.headers.get('accept')?.includes('text/html')) {
      return caches.match('./index.html');
    }
    throw error;
  }
}

// Cache-first with size limit for images
async function cacheFirstWithLimit(request, cacheName, maxSize) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse?.status === 200) {
      const cache = await caches.open(cacheName);
      
      // Manage cache size - remove oldest entries when limit reached
      const keys = await cache.keys();
      while (keys.length >= maxSize) {
        await cache.delete(keys.shift());
      }
      
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    return new Response('Image not available offline', { 
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}

// Network-first strategy for dynamic resources
async function networkFirstStrategy(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

// Fetch event - smart caching strategy (matching GarfieldApp/DirkJanApp pattern)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  if (request.method !== 'GET') return;
  
  const url = new URL(request.url);
  const { destination } = request;
  
  // Skip cross-origin requests
  if (url.origin !== location.origin) return;
  
  // Cache-first for app shell (HTML, CSS, JS, SVG)
  if (['document', 'style', 'script'].includes(destination) || url.pathname.endsWith('.svg')) {
    event.respondWith(cacheFirstStrategy(request, CACHE_NAME));
    return;
  }
  
  // Cache-first with size limit for images
  if (destination === 'image') {
    event.respondWith(cacheFirstWithLimit(request, CACHE_NAME, MAX_IMAGE_CACHE_SIZE));
    return;
  }
  
  // Network-first for other resources
  event.respondWith(networkFirstStrategy(request, CACHE_NAME));
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});