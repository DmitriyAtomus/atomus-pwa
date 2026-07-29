const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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

test('CRM повторяет API-запрос напрямую при HTML 403 от Vercel VPN-защиты', () => {
  const app = read('app-1.js');
  assert.match(
    app,
    /const API_DIRECT_FALLBACK = 'https:\/\/worker-production-9b70\.up\.railway\.app'/
  );
  assert.match(app, /response\.status !== 403/);
  assert.match(app, /!contentType\.includes\('text\/html'\)/);
  assert.match(app, /_atomusNativeFetch\(fallbackUrl, init\)/);
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
