/* Atomus PWA Service Worker
   Стратегия:
   - HTML/CSS/иконки → кэш-first (берём из кэша, в фоне обновляем)
   - API → network-first (всегда свежие данные, кэш только как fallback при оффлайне)

   Версия кэша обновляется при каждом релизе — старая инвалидируется.
*/
const CACHE_VERSION = 'atomus-v1.8.338';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

// Файлы, которые нужно закэшировать сразу при установке SW
const STATIC_ASSETS = [
  '/',
  '/index.html',
  // v2.45.162: CSS и JS вынесены из index.html; v2.45.175: app.js разнесён на 4 части
  '/app.css',
  '/app-1.js',
  '/app-2.js',
  '/app-3.js',
  '/app-4.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/favicon-32.png',
  // Внешние ресурсы из CDN, нужные для оформления
  'https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/3.34.0/tabler-icons.min.css',
];

// При установке — пополняем static cache. БЕЗ skipWaiting:
// новый SW зависает в "waiting", пока страница не пошлёт ему SKIP_WAITING.
// Это позволяет показать пользователю баннер «Доступно обновление» и дать ему
// решить, когда переключиться — чтобы не сбросить заполненную форму.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return Promise.all(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('SW: не удалось закэшировать', url, err);
          })
        )
      );
    })
  );
});

// Страница может попросить нас активироваться немедленно
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' ||
      (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

// При активации — удаляем старые кэши
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          // v2.45.222: atomus-share-intake — буфер «Поделиться», не трогаем
          .filter((key) => !key.startsWith(CACHE_VERSION) && key !== 'atomus-share-intake')
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Обработка запросов
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // v2.45.222: Web Share Target — «Поделиться → Atom» из любого приложения.
  // Файл счёта складываем в cache, редиректим в приложение — оно подхватит
  // и загрузит во «Входящие счета».
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share-invoice') {
    event.respondWith((async () => {
      try {
        const formData = await req.formData();
        const files = formData.getAll('file');
        const cache = await caches.open('atomus-share-intake');
        let i = 0;
        for (const f of files) {
          if (!f || typeof f.arrayBuffer !== 'function') continue;
          await cache.put('/share-intake/' + i, new Response(f, {
            headers: {
              'X-Name': encodeURIComponent(f.name || ('file' + i)),
              'Content-Type': f.type || 'application/octet-stream',
            },
          }));
          i++;
        }
        await cache.put('/share-intake/meta', new Response(JSON.stringify({ count: i })));
      } catch (e) { /* не валим редирект */ }
      return Response.redirect('/?share=invoice', 303);
    })());
    return;
  }

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
    // Исключение: /3d/* — это 3D-вьюверы, которые часто обновляются.
    // Если их закэшировать — пользователь будет видеть старую модель после
    // деплоя. Сетевой запрос с фолбэком на кэш (на случай оффлайна).
    if (url.pathname.startsWith('/3d/')) {
      event.respondWith(networkFirst(req));
      return;
    }
    // version.json — всегда свежий (показывает какая версия доступна к установке)
    if (url.pathname === '/version.json') {
      event.respondWith(networkFirst(req));
      return;
    }
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

// === v2.45.148: Web Push (PWA-уведомления) ===
// Сервер шлёт зашифрованный пуш; здесь показываем системное уведомление.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) {
    payload = { title: 'Atom CRM', body: (event.data && event.data.text()) || '' };
  }
  const title = payload.title || 'Atom CRM';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon-32.png',
    tag: payload.tag || undefined,
    renotify: !!payload.tag,
    data: { url: payload.url || '/' },
    vibrate: [120, 60, 120],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Клик по уведомлению — открыть/сфокусировать приложение
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) { c.focus(); return; }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

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
