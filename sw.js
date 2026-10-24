/* Service worker: сеть в приоритете, кэш — страховка офлайн.
   ВАЖНО: запросы к API (workers.dev) не кэшируем — иначе платный контент
   и устаревшие права осядут в кэше браузера. */
const CACHE = 'polyus6-v2';
const CORE = ['./', './index.html', './style.css', './app.js', './data.js', './platform.js', './manifest.json', './icon.svg',
  './fonts/inter-cyrillic.woff2', './fonts/inter-latin.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname.endsWith('workers.dev')) return;   // API — только сеть
  e.respondWith(
    fetch(e.request).then(r => {
      const cp = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, cp)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request).then(m => m || caches.match('./index.html')))
  );
});
