const PREFIX = 'cleaver-arena-';
const CACHE = `${PREFIX}v3`;
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

async function store(request, response) {
  if (!response.ok) return;
  try {
    const copy = response.clone();
    const cache = await caches.open(CACHE);
    await cache.put(request, copy);
  } catch {}
}

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && url.pathname === '/') {
    let timer;
    const network = fetch(request);
    event.waitUntil(network.then(response => !url.search ? store('/', response) : undefined).catch(() => {}));
    event.respondWith(Promise.race([
      network.then(response => { if (!response.ok) throw new Error('navigation failed'); return response; }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('navigation timeout')), 3000); }),
    ]).catch(async () => await caches.match('/', { cacheName: CACHE }) ?? Response.error()).finally(() => clearTimeout(timer)));
    return;
  }
  const immutable = /^\/assets\/[^/]+-[\w-]+\.(js|css)$/.test(url.pathname);
  const staticFile = url.pathname === '/manifest.webmanifest' || /^\/fonts\/[^/]+\.woff2$/.test(url.pathname) || /^\/icons\/[^/]+\.png$/.test(url.pathname) || /^\/models\/[^/]+\.glb$/.test(url.pathname);
  if (!immutable && !staticFile) return;
  const cached = caches.match(request, { cacheName: CACHE });
  const network = cached.then(hit => {
    if (immutable && hit) return hit;
    return fetch(request);
  });
  event.waitUntil(network.then(response => store(request, response)).catch(() => {}));
  event.respondWith(cached.then(hit => hit ?? network));
});
