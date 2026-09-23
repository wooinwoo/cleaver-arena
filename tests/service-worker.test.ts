import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function harness() {
  const origin = 'https://game.test';
  const stores = new Map<string, Map<string, Response>>();
  const handlers = new Map<string, (event: any) => void>();
  const calls: string[] = [];
  let fetcher = async (_request: Request) => new Response('network');
  const key = (request: string | Request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        put: async (request: string | Request, response: Response) => { store.set(key(request), response.clone()); },
        addAll: async (urls: string[]) => { for (const url of urls) store.set(key(url), new Response('shell')); },
      };
    },
    match: async (request: string | Request, options: { cacheName: string }) => stores.get(options.cacheName)?.get(key(request))?.clone(),
  };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    URL, Response, setTimeout, clearTimeout, caches,
    fetch: (request: Request) => { calls.push(key(request)); return fetcher(request); },
    self: { location: { origin }, clients: { claim: async () => {} }, skipWaiting: async () => {}, addEventListener: (type: string, handler: (event: any) => void) => handlers.set(type, handler) },
  });
  function dispatch(type: string, path = '/', navigate = false) {
    const work: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    const request = { url: key(path), method: 'GET', mode: navigate ? 'navigate' : 'cors' };
    handlers.get(type)!({ request, waitUntil: (promise: Promise<unknown>) => work.push(promise), respondWith: (promise: Promise<Response>) => { response = promise; } });
    return { response, done: () => Promise.all(work) };
  }
  return { caches, calls, dispatch, setFetch: (value: typeof fetcher) => { fetcher = value; } };
}

test('warm hashed assets return from cache without a network request', async () => {
  const h = harness();
  const cache = await h.caches.open('cleaver-arena-v4');
  await cache.put('/assets/index-abc123.js', new Response('cached'));
  h.setFetch(() => new Promise(() => {}));
  const event = h.dispatch('fetch', '/assets/index-abc123.js');
  assert.equal(await (await event.response!).text(), 'cached');
  await event.done();
  assert.equal(h.calls.length, 0);
});

test('static cache hits do not wait for revalidation and misses return a response', async () => {
  const h = harness();
  const cache = await h.caches.open('cleaver-arena-v4');
  await cache.put('/fonts/club-kr.woff2', new Response('old'));
  let resolve!: (response: Response) => void;
  h.setFetch(() => new Promise(done => { resolve = done; }));
  const event = h.dispatch('fetch', '/fonts/club-kr.woff2');
  assert.equal(await (await event.response!).text(), 'old');
  resolve(new Response('new'));
  await event.done();
  assert.equal(await (await h.caches.match('/fonts/club-kr.woff2', { cacheName: 'cleaver-arena-v4' }))!.text(), 'new');
  h.setFetch(async () => new Response('model'));
  const miss = h.dispatch('fetch', '/models/mundo.glb');
  assert.equal(await (await miss.response!).text(), 'model');
  await miss.done();
});

test('navigation fallback preserves the shell and failed responses never poison caches', async () => {
  const h = harness();
  await h.dispatch('install').done();
  h.setFetch(async () => new Response('unavailable', { status: 503 }));
  const navigation = h.dispatch('fetch', '/', true);
  assert.equal(await (await navigation.response!).text(), 'shell');
  await navigation.done();
  h.setFetch(async () => new Response('invite'));
  const invite = h.dispatch('fetch', '/?room=ABC123', true);
  assert.equal(await (await invite.response!).text(), 'invite');
  await invite.done();
  assert.equal(await (await h.caches.match('/', { cacheName: 'cleaver-arena-v4' }))!.text(), 'shell');
  h.setFetch(async () => { throw new Error('offline'); });
  const offline = h.dispatch('fetch', '/', true);
  assert.equal(await (await offline.response!).text(), 'shell');
  await offline.done();
});

test('activation preserves unrelated caches and unknown requests bypass the worker', async () => {
  const h = harness();
  await h.caches.open('unrelated');
  await h.caches.open('cleaver-arena-v1');
  await h.caches.open('cleaver-arena-v2');
  await h.caches.open('cleaver-arena-v4');
  await h.dispatch('activate').done();
  assert.deepEqual(await h.caches.keys(), ['unrelated', 'cleaver-arena-v4']);
  for (const path of ['/health', '/ws', '/table-ws', '/api/state', '/sw.js']) assert.equal(h.dispatch('fetch', path).response, undefined);
  assert.equal(h.calls.length, 0);
});
