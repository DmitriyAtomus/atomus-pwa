/* Atomus PWA Service Worker
   Стратегия:
   - HTML/CSS/иконки → кэш-first (берём из кэша, в фоне обновляем)
   - API (/api/*) → только сеть, БЕЗ кэша (v2.46.243): при сбое прокси Vercel
     раньше молча отдавался старый ответ; теперь запрос падает, и страница
     сразу уходит на прямой api.atomuscrm.ru или честно пишет «Нет связи»

   Версия кэша обновляется при каждом релизе — старая инвалидируется.
*/
const CACHE_VERSION = 'atomus-v2.46.249';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
// v2.46.243: данные API больше НЕ кэшируются. Кэш только для файлов /static/*.
const FILES_CACHE = `${CACHE_VERSION}-files`;

// Файлы, которые нужно закэшировать сразу при установке SW
const STATIC_ASSETS = [
  '/',
  '/index.html',
  // v2.45.162: CSS и JS вынесены из index.html; v2.45.175: app.js разнесён на 4 части
  '/app.css',
  '/api-fix.js',
  '/app-1.js',
  '/app-2.js',
  '/app-3.js',
  '/app-4.js',
  '/prospects.js',
  '/prospects.css',
  '/campaigns.js',
  '/campaigns.css',
  '/presentations.js',
  '/presentations.css',
  '/klava-pick.js',
  // v2.46.245: Sentry user/section/spans
  '/vendor/sentry-11.4.0.bundle.tracing.min.js',
  '/sentry-init.js',
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
          // v2.46.243: и любые старые кэши данных API (…-api) — тоже под снос
          .filter((key) => (!key.startsWith(CACHE_VERSION) || /-api$/.test(key)) && key !== 'atomus-share-intake')
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

  // v2.46.243: ВСЕ запросы к данным (/api/*, любые методы, свои и старый
  // railway.app) идут мимо service worker — браузер шлёт их сам, без кэша.
  // Так ошибка прокси видна странице сразу и побеждает прямой api.atomuscrm.ru
  // (fallback в app-1.js), а не сохранённый когда-то ответ.
  if ((url.origin === self.location.origin &&
       (url.pathname === '/api' || url.pathname.startsWith('/api/'))) ||
      url.hostname.includes('railway.app') ||
      url.hostname === 'api.atomuscrm.ru') {
    return;
  }

  // v2.46.242: публичные ссылки на презентации — только сеть
  if (url.pathname.startsWith('/pres/')) {
    return;
  }

  // Только GET запросы кэшируем
  if (req.method !== 'GET') return;

  // Файлы backend (/static/*: фото, вложения) — network-first с кэшем файлов,
  // чтобы уже открытые фото были видны и без сети. Это не списки данных.
  if (url.origin === self.location.origin &&
      (url.pathname === '/static' || url.pathname.startsWith('/static/'))) {
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
    // v2.45.325: /atomcad/* — модуль «Атом Электрика», активно дорабатывается,
    // поэтому всегда свежий (network-first), чтобы не залипал старый билд.
    if (url.pathname.startsWith('/atomcad/')) {
      event.respondWith(networkFirst(req));
      return;
    }
    // /chiller/* — модуль «Атом Чиллер», тоже в активной доработке: оболочка
    // должна приезжать свежей, иначе после выкатки останется старая.
    if (url.pathname.startsWith('/chiller/')) {
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
    // v2.46.243: index.html — только вместо страницы, не вместо скрипта/картинки
    // (иначе оффлайн внешняя библиотека падала «Unexpected token '<'»)
    if (req.mode === 'navigate') {
      const fallback = (await caches.match('/index.html')) || (await caches.match('/'));
      if (fallback) return fallback;
    }
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
    const cc = (res && res.headers.get('Cache-Control')) || '';
    if (res && res.ok && !/no-store/i.test(cc)) {   // v2.46.242: no-store не кладём в кэш
      // Кэшируем успешные GET-ответы API (только если есть Authorization,
      // чтобы кэш привязывался к пользователю — но мы не различаем по токену
      // в Cache API, поэтому просто кэшируем; если другой пользователь зайдёт,
      // он получит свежее сразу как только сеть появится)
      const cache = await caches.open(FILES_CACHE);
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
