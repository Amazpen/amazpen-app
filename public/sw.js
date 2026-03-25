// BUILD_TIME=1774435648470
const CACHE_NAME = 'amazpen-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icon.svg',
];

// Install event - cache static assets and activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // Activate immediately — don't wait for user to click "update"
  self.skipWaiting();
});

// Activate event - clear ALL caches on new SW version to prevent stale content
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => caches.delete(name))
      );
    }).then(() => {
      // Re-cache only essential static assets with fresh content
      return caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS));
    })
  );
  self.clients.claim();
});

// Listen for SKIP_WAITING message from the client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Push notification received
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'המצפן';
  const options = {
    body: data.message || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    dir: 'rtl',
    lang: 'he',
    tag: data.tag || 'amazpen-notification',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click - open/focus the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(url);
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});

// Fetch event - network first, cache only safe static assets
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension and other non-http(s) requests
  if (!event.request.url.startsWith('http')) return;

  // Never cache sw.js itself — browser handles SW updates separately
  if (event.request.url.includes('/sw.js')) return;

  // Navigation requests (HTML pages) — ALWAYS go to network, never serve stale HTML
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/') || new Response('Offline', { status: 503 }))
    );
    return;
  }

  // API requests — never cache
  if (event.request.url.includes('/api/')) return;

  // Next.js chunks (_next/) — never cache (hashed filenames change per deploy)
  if (event.request.url.includes('/_next/')) return;

  // Only cache safe static assets (images, icons, manifest)
  var isSafeStatic = event.request.url.match(/\.(png|jpg|jpeg|svg|ico|webp|woff2?)(\?|$)/)
    || event.request.url.includes('/manifest.json');

  event.respondWith(
    fetch(event.request)
      .then(function(response) {
        if (response.status === 200 && isSafeStatic) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
        }
        return response;
      })
      .catch(function() {
        return caches.match(event.request).then(function(cached) {
          return cached || new Response('Offline', { status: 503 });
        });
      })
  );
});
