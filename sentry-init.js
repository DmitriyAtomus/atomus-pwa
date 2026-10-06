/* v2.46.244: Sentry — мониторинг ошибок фронтенда (Atom CRM).
   - Только ошибки + 5% трассировок; Session Replay НЕ подключён (бандл без replay).
   - sendDefaultPii: false — IP, cookies, тела запросов не отправляются.
   - Токены из ссылок (/a/<token>, ?token=...) вырезаются перед отправкой.
   - На crm.atomuscrm.ru / *.workers.dev события идут через свой Worker
     (/sentry-tunnel) — не режутся блокировщиками. На Vercel (откат) — напрямую.
   - Версия (release) берётся из APP_VERSION (app-1.js) в момент отправки.
   - Тест: открыть /?sentry_test=1 — уйдёт тестовая ошибка. */
(function () {
  if (!window.Sentry || typeof window.Sentry.init !== 'function') return;
  var DSN = 'https://87184ea72b0f98bac38450c549cadea8@o4512209219616768.ingest.de.sentry.io/4512209395843152';
  var host = location.hostname;
  var onWorker = host === 'crm.atomuscrm.ru' || /\.workers\.dev$/.test(host);
  var env = host === 'crm.atomuscrm.ru' ? 'production'
    : /\.workers\.dev$/.test(host) ? 'workers-dev'
    : /vercel\.app$/.test(host) ? 'vercel' : 'other';

  var TOKEN_PATH = /\/(a|b|c|d|u|dev|kp|pres)\/[^/?#\s"']{6,}/g;
  var TOKEN_QS = /([?&](?:token|t|code|key|password|guest|auth)[^=&#]*=)[^&#\s"']*/gi;
  function scrub(s) {
    return typeof s === 'string' ? s.replace(TOKEN_PATH, '/$1/[token]').replace(TOKEN_QS, '$1[filtered]') : s;
  }
  function currentRelease() {
    try { if (typeof APP_VERSION === 'string') return 'atomus-pwa@' + APP_VERSION; } catch (e) {}
    return undefined;
  }
  function clean(event) {
    var rel = currentRelease();
    if (rel) event.release = rel;
    if (event.request) {
      if (event.request.url) event.request.url = scrub(event.request.url);
      if (event.request.query_string) event.request.query_string = '[filtered]';
      delete event.request.cookies;
      if (event.request.headers) { delete event.request.headers.Referer; delete event.request.headers.referer; }
    }
    if (event.transaction) event.transaction = scrub(event.transaction);
    if (event.breadcrumbs) {
      event.breadcrumbs.forEach(function (b) {
        if (b.message) b.message = scrub(b.message);
        if (b.data) {
          if (b.data.url) b.data.url = scrub(b.data.url);
          if (b.data.from) b.data.from = scrub(b.data.from);
          if (b.data.to) b.data.to = scrub(b.data.to);
        }
      });
    }
    if (event.spans) {
      event.spans.forEach(function (sp) {
        if (sp.description) sp.description = scrub(sp.description);
        if (sp.data && sp.data.url) sp.data.url = scrub(sp.data.url);
      });
    }
    return event;
  }

  window.Sentry.init({
    dsn: DSN,
    environment: env,
    tunnel: onWorker ? '/sentry-tunnel' : undefined,
    sendDefaultPii: false,
    integrations: [window.Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.05,
    // trace-заголовки только в свой /api (через прокси Worker). На прямой
    // api.atomuscrm.ru НЕ шлём: его CORS не разрешает sentry-trace/baggage.
    tracePropagationTargets: [/^\/api\//, /^https:\/\/crm\.atomuscrm\.ru\/api\//],
    maxBreadcrumbs: 50,
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
    ],
    beforeSend: clean,
    beforeSendTransaction: clean,
  });

  if (/[?&]sentry_test=1\b/.test(location.search)) {
    setTimeout(function () {
      window.Sentry.captureException(new Error('Atom CRM Sentry test event (' + env + ')'));
    }, 1500);
  }
})();
