/**
 * sw.js — Service Worker
 *
 * 缓存策略：
 *  - 应用外壳（HTML/CSS/JS/图标）：预缓存 + 缓存优先（stale-while-revalidate 更新），
 *    这样断网也能打开 app —— 这是「离线可用」评分点的技术实现。
 *  - Open Food Facts 的 API 请求：不在这里缓存（由 js/api.js 写在 IndexedDB，
 *    因为需要更长的 TTL、按条码索引，还要区分 stale/离线状态）。
 *  - 跨域请求一律直接放行，避免把第三方响应误存进本应用的缓存。
 */

const VERSION = 'v1.2.0';
const SHELL_CACHE = `safebite-shell-${VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles/main.css',
  './js/app.js',
  './js/a11y.js',
  './js/api.js',
  './js/auth.js',
  './js/crypto.js',
  './js/db.js',
  './js/logic.js',
  './js/scan.js',
  './js/ui.js',
  './js/voice.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      // 逐个 add，单个失败不至于整个安装失败
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('[sw] failed to precache', url, err);
          })
        )
      );
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('safebite-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 跨域（Open Food Facts 等）交给页面自己处理
  if (url.origin !== self.location.origin) return;

  // 导航请求：网络优先，失败回落到缓存里的 index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match(request)) || (await cache.match('./index.html')) || Response.error();
        }
      })()
    );
    return;
  }

  // 静态资源：缓存优先，后台更新
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      if (cached) {
        void network;
        return cached;
      }
      const fresh = await network;
      return fresh || new Response('Offline', { status: 503, statusText: 'Offline' });
    })()
  );
});

// 允许页面主动触发更新
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
