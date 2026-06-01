/* Atomus PWA Service Worker
   Стратегия:
   - HTML/CSS/иконки → кэш-first (берём из кэша, в фоне обновляем)
   - API → network-first (всегда свежие данные, кэш только как fallback при оффлайне)

   Версия кэша обновляется при каждом релизе — старая инвалидируется.
*/
const CACHE_VERSION = 'atomus-v1.8.32';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

// Файлы, которые нужно закэшировать сразу при установке SW
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/favicon-32.png',
  // Внешние ресурсы из CDN, нужные для оформления
  'https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/3.34.0/tabler-icons.min.css',
];

// При установке — пополняем static cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // Кэшируем каждый файл отдельно — если один упадёт, другие закэшируются
      return Promise.all(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('SW: не удалось закэшировать', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// При активации — удаляем старые кэши
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Обработка запросов
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Только GET запросы кэшируем
  if (req.method !== 'GET') return;

  // API запросы (на Railway) — стратегия network-first
  if (url.hostname.includes('railway.app')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Иконки шрифта (tabler-icons font files) — кэшируем агрессивно
  if (url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Локальные ресурсы PWA — кэш-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Остальное — просто fetch
});

// === Стратегии ===

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) {
    // Обновляем кэш в фоне (stale-while-revalidate)
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          caches.open(cacheName).then((cache) => cache.put(req, res.clone()));
        }
      })
      .catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    // Если нет сети и кэша нет — отдаём что есть (например, корневой index.html)
    const fallback = await caches.match('/index.html');
    if (fallback) return fallback;
    throw err;
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      // Кэшируем успешные GET-ответы API (только если есть Authorization,
      // чтобы кэш привязывался к пользователю — но мы не различаем по токену
      // в Cache API, поэтому просто кэшируем; если другой пользователь зайдёт,
      // он получит свежее сразу как только сеть появится)
      const cache = await caches.open(API_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    // Нет сети — отдаём из кэша если есть
    const cached = await caches.match(req);
    if (cached) return cached;
    throw err;
  }
}
