/* v2.46.245: Sentry — мониторинг ошибок фронтенда (Atom CRM).
   - Ошибки + 100% трассировок (маленькая команда).
   - Session Replay НЕ подключён. sendDefaultPii: false.
   - После входа: user={id: employee_id, username: имя} + tag role (без телефона/email).
   - Tag section на навигации (login, chats, tasks, reports, presentations, …).
   - Кастомные спаны: открытие списка чатов / чата / задач / отчётов.
   - Провалы /api (5xx, сеть, таймаут) → события с tag section.
   - Токены из ссылок вырезаются. Туннель /sentry-tunnel на Worker.
   - Тест: /?sentry_test=1 */
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
      if (event.request.headers) {
        delete event.request.headers.Referer;
        delete event.request.headers.referer;
        delete event.request.headers.Authorization;
        delete event.request.headers.authorization;
      }
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

  var _section = 'login';
  var ROLE_PRIORITY = ['director', 'zam', 'manager', 'engineer', 'master', 'accountant', 'installer'];

  function primaryRole(roles) {
    roles = roles || [];
    for (var i = 0; i < ROLE_PRIORITY.length; i++) {
      if (roles.indexOf(ROLE_PRIORITY[i]) >= 0) return ROLE_PRIORITY[i];
    }
    return roles[0] || 'unknown';
  }

  function setSection(name) {
    if (!name || typeof name !== 'string') return;
    _section = name.slice(0, 64);
    try { window.Sentry.setTag('section', _section); } catch (e) {}
  }

  function setUserFromMe(me) {
    if (!me) {
      try { window.Sentry.setUser(null); window.Sentry.setTag('role', undefined); } catch (e) {}
      setSection('login');
      return;
    }
    var id = me.employee_id != null ? me.employee_id : me.id;
    var name = me.short_name || me.full_name || me.name || ('emp-' + (id != null ? id : '?'));
    var role = primaryRole(me.roles);
    try {
      window.Sentry.setUser(id != null
        ? { id: String(id), username: String(name).slice(0, 128) }
        : { username: String(name).slice(0, 128) });
      window.Sentry.setTag('role', role);
    } catch (e) {}
  }

  function sectionFromNav(sectionName, screenName) {
    var screenMap = {
      'defects-chats': 'chats',
      'developments': 'chats',
      'presentations': 'presentations',
      'sales-reports': 'reports',
      'sales-report': 'reports',
      'login': 'login',
    };
    if (screenName && screenMap[screenName]) return screenMap[screenName];
    if (sectionName === 'tasks') return 'tasks';
    if (sectionName === 'sales') return 'sales';
    if (sectionName === 'defects') return 'defects';
    if (sectionName) return String(sectionName).slice(0, 64);
    return _section || 'home';
  }

  function startUiSpan(op, name, fn) {
    if (typeof fn !== 'function') fn = function () {};
    if (typeof window.Sentry.startSpan !== 'function') return fn();
    return window.Sentry.startSpan(
      { name: name || op, op: op || 'ui.action', attributes: { section: _section } },
      fn
    );
  }

  function captureApiFailure(info) {
    info = info || {};
    var status = info.status;
    var path = scrub(String(info.path || ''));
    var method = info.method || 'GET';
    var kind = info.kind || 'http_error';
    var msg;
    if (kind === 'network') msg = 'API network error: ' + method + ' ' + path;
    else if (kind === 'timeout') msg = 'API timeout: ' + method + ' ' + path;
    else msg = 'API ' + (status || '?') + ': ' + method + ' ' + path;
    try {
      window.Sentry.withScope(function (scope) {
        scope.setTag('section', _section);
        scope.setTag('api_status', String(status || kind));
        scope.setTag('api_method', method);
        scope.setFingerprint(['api-fail', method, path.replace(/\/\d+/g, '/:id'), String(status || kind)]);
        scope.setLevel(status >= 500 || kind === 'network' || kind === 'timeout' ? 'error' : 'warning');
        scope.setContext('api', { method: method, path: path, status: status || null, kind: kind });
        window.Sentry.captureMessage(msg);
      });
    } catch (e) {}
  }

  window.Sentry.init({
    dsn: DSN,
    environment: env,
    tunnel: onWorker ? '/sentry-tunnel' : undefined,
    sendDefaultPii: false,
    integrations: [window.Sentry.browserTracingIntegration()],
    tracesSampleRate: 1.0,
    traceLifecycle: 'static',
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

  try { window.Sentry.setTag('section', 'login'); } catch (e) {}

  window.AtomusSentry = {
    setUserFromMe: setUserFromMe,
    setSection: setSection,
    sectionFromNav: sectionFromNav,
    startUiSpan: startUiSpan,
    captureApiFailure: captureApiFailure,
    getSection: function () { return _section; },
    scrub: scrub,
  };

  if (/[?&]sentry_test=1\b/.test(location.search)) {
    setTimeout(function () {
      try {
        window.Sentry.setTag('section', _section || 'login');
        window.Sentry.captureException(new Error('Atom CRM Sentry test event (' + env + ', v2.46.245)'));
      } catch (e) {}
    }, 1500);
  }
})();
