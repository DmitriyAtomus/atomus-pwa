const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('все браузерные модули используют same-origin API', () => {
  assert.match(read('app-1.js'), /const API_BASE = window\.location\.origin/);
  assert.match(
    read('oprosnik-syrovarnya.html'),
    /endpoint: window\.location\.origin \+ '\/api\/public\/survey\/submit'/
  );
  assert.match(read('atomcad/wizard.html'), /var ATOMCAD_API=window\.location\.origin/);
});

test('CRM распознаёт HTML 403 от Vercel VPN-защиты', () => {
  const app = read('app-1.js');
  assert.match(
    app,
    /const API_DIRECT_FALLBACK = 'https:\/\/worker-production-9b70\.up\.railway\.app'/
  );
  assert.match(app, /response\.status !== 403/);
  assert.match(app, /if \(contentType\.includes\('text\/html'\)\) return true/);
  assert.match(app, /await _isVercelSecurityResponse\(response\)/);
  assert.match(app, /_atomusNativeFetch\(fallbackUrl, init\)/);
});

function loadFetchProxy(nativeFetch) {
  const app = read('app-1.js');
  const end = app.indexOf('const TOKEN_KEY');
  assert.notEqual(end, -1);
  const context = {
    URL,
    window: {
      location: { origin: 'https://atomus-pwa.vercel.app' },
      fetch: nativeFetch,
    },
  };
  vm.runInNewContext(app.slice(0, end), context);
  return context.window.fetch;
}

function fakeResponse(status, contentType, payload) {
  return {
    status,
    headers: { get: () => contentType },
    clone() { return { json: async () => payload }; },
  };
}

test('JSON-объект защиты Vercel повторяется напрямую в Railway', async () => {
  const calls = [];
  const blocked = fakeResponse(403, 'application/json', {
    error: { code: 'security_checkpoint', message: 'Forbidden' },
  });
  const ok = fakeResponse(200, 'application/json', { ok: true });
  const fetch = loadFetchProxy(async (url) => {
    calls.push(String(url));
    return calls.length === 1 ? blocked : ok;
  });

  const response = await fetch('/api/auth/password', { method: 'POST' });

  assert.equal(response, ok);
  assert.deepEqual(calls, [
    '/api/auth/password',
    'https://worker-production-9b70.up.railway.app/api/auth/password',
  ]);
});

test('обычный неправильный пароль не отправляется второй раз', async () => {
  const calls = [];
  const denied = fakeResponse(403, 'application/json', {
    error: 'invalid_password', message: 'Неверный пароль',
  });
  const fetch = loadFetchProxy(async (url) => {
    calls.push(String(url));
    return denied;
  });

  const response = await fetch('/api/auth/password', { method: 'POST' });

  assert.equal(response, denied);
  assert.deepEqual(calls, ['/api/auth/password']);
});

test('Vercel проксирует API и серверные файлы в Railway', () => {
  const config = JSON.parse(read('vercel.json'));
  const rewrites = new Map(config.rewrites.map((rule) => [rule.source, rule.destination]));

  assert.equal(
    rewrites.get('/api/:path*'),
    'https://worker-production-9b70.up.railway.app/api/:path*'
  );
  assert.equal(
    rewrites.get('/static/:path*'),
    'https://worker-production-9b70.up.railway.app/static/:path*'
  );
});

test('Service Worker не подменяет API устаревшим статическим кэшем', () => {
  const serviceWorker = read('sw.js');
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/static\/'\)/);
  assert.match(serviceWorker, /event\.respondWith\(networkFirst\(req\)\)/);
});
