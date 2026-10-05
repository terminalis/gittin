// Precache every built file; serve cached files first. Anything else (future API/auth) goes to the network.
const CACHE = 'gittin-__VERSION__', FILES = __FILES__;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('gittin-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', event => { if (event.data === 'skip-waiting') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(caches.match(request, { ignoreSearch: true, ignoreVary: true }).then(cached => cached ?? fetch(request)));
});
