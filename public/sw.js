/* 친구네 오락실 서비스워커: 앱 셸을 가볍게 캐시한다. 게임 상태는 실시간 WebSocket이 담당하므로 API/WS는 건드리지 않는다. */
const VERSION = 'cleaver-arena-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/ws' || url.pathname === '/table-ws' || url.pathname === '/health') return;

  // 내비게이션(앱 실행)은 네트워크 우선, 실패 시 캐시된 셸로 폴백한다.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(cache => cache.put('/', copy));
      return res;
    }).catch(() => caches.match('/')));
    return;
  }

  // 빌드 산출물(/assets/*)은 stale-while-revalidate, 그 외 정적 파일은 캐시 우선이다.
  event.respondWith(
    caches.match(request).then(hit => {
      const network = fetch(request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(cache => cache.put(request, copy));
        }
        return res;
      }).catch(() => hit);
      return url.pathname.startsWith('/assets/') ? network.then(res => res || hit) : hit || network;
    }),
  );
});
