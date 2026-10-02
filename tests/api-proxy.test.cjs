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
    /const API_DIRECT_FALLBACK = 'https:\/\/entry-encyclopedia-gmbh-career\.trycloudflare\.com'/
  );
  assert.match(app, /response\.status !== 403/);
  assert.match(app, /if \(response\.status === 403\)/);
  assert.match(app, /catch \(_\)/);
  assert.match(app, /_atomusNativeFetch\(fallbackUrl, init\)/);
});

function loadFetchProxy(nativeFetch) {
  const app = read('app-1.js')
    .replace('const API_GET_HEDGE_DELAY_MS = 450;', 'const API_GET_HEDGE_DELAY_MS = 5;')
    .replace('const API_GET_TIMEOUT_MS = 12000;', 'const API_GET_TIMEOUT_MS = 1000;');
  const end = app.indexOf('const TOKEN_KEY');
  assert.notEqual(end, -1);
  const context = {
    URL,
    setTimeout,
    clearTimeout,
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
    'https://entry-encyclopedia-gmbh-career.trycloudflare.com/api/auth/password',
  ]);
});

test('same-origin API 403 retries through the direct fallback', async () => {
  const calls = [];
  const denied = fakeResponse(403, 'application/json', {
    error: 'invalid_password', message: 'backend forbidden',
  });
  const fetch = loadFetchProxy(async (url) => {
    calls.push(String(url));
    return denied;
  });

  const response = await fetch('/api/auth/password', { method: 'POST' });

  assert.equal(response, denied);
  assert.deepEqual(calls, [
    '/api/auth/password',
    'https://entry-encyclopedia-gmbh-career.trycloudflare.com/api/auth/password',
  ]);
});

test('same-origin API network failure retries non-GET through the direct fallback', async () => {
  const calls = [];
  const ok = fakeResponse(200, 'application/json', { ok: true });
  const fetch = loadFetchProxy(async (url) => {
    calls.push(String(url));
    if (calls.length === 1) throw new Error('edge unavailable');
    return ok;
  });

  const response = await fetch('/api/auth/password', { method: 'POST', body: '{}' });

  assert.equal(response, ok);
  assert.deepEqual(calls, [
    '/api/auth/password',
    'https://entry-encyclopedia-gmbh-career.trycloudflare.com/api/auth/password',
  ]);
});


test('GET JSON 403 is never returned as a same-origin CRM response', async () => {
  const calls = [];
  const blocked = fakeResponse(403, 'application/json', { error: 'forbidden' });
  const ok = fakeResponse(200, 'application/json', { ok: true });
  const fetch = loadFetchProxy(async (url) => {
    calls.push(String(url));
    return calls.length === 1 ? blocked : ok;
  });

  const response = await fetch('/api/me');

  assert.equal(response, ok);
  assert.deepEqual(calls, [
    '/api/me',
    'https://entry-encyclopedia-gmbh-career.trycloudflare.com/api/me',
  ]);
});
test('медленный GET страхуется прямым запросом и не ждёт Vercel', async () => {
  const calls = [];
  const ok = fakeResponse(200, 'application/json', { ok: true });
  const never = new Promise(() => {});
  const fetch = loadFetchProxy(async (url) => {
    calls.push(String(url));
    return calls.length === 1 ? never : ok;
  });

  const response = await fetch('/api/contracts?limit=200', { cache: 'no-store' });

  assert.equal(response, ok);
  assert.deepEqual(calls, [
    '/api/contracts?limit=200',
    'https://entry-encyclopedia-gmbh-career.trycloudflare.com/api/contracts?limit=200',
  ]);
});

test('быстрый GET остаётся на same-origin и не создаёт дубль', async () => {
  const calls = [];
  const ok = fakeResponse(200, 'application/json', { ok: true });
  const fetch = loadFetchProxy(async (url) => {
    calls.push(String(url));
    return ok;
  });

  const response = await fetch('/api/dashboard');
  await new Promise(resolve => setTimeout(resolve, 15));

  assert.equal(response, ok);
  assert.deepEqual(calls, ['/api/dashboard']);
});

test('Vercel проксирует API и серверные файлы в Railway', () => {
  const config = JSON.parse(read('vercel.json'));
  const rewrites = new Map(config.rewrites.map((rule) => [rule.source, rule.destination]));

  assert.equal(
    rewrites.get('/api/:path*'),
    'https://entry-encyclopedia-gmbh-career.trycloudflare.com/api/:path*'
  );
  assert.equal(
    rewrites.get('/static/:path*'),
    'https://entry-encyclopedia-gmbh-career.trycloudflare.com/static/:path*'
  );
});

test('Service Worker не подменяет API устаревшим статическим кэшем', () => {
  const serviceWorker = read('sw.js');
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/static\/'\)/);
  assert.match(serviceWorker, /event\.respondWith\(networkFirst\(req\)\)/);
});

test('планёрка сохраняется по подтвердившему чтение прямому маршруту', async () => {
  const calls=[];
  const direct='https://entry-encyclopedia-gmbh-career.trycloudflare.com';
  const ok={...fakeResponse(200,'application/json',{ok:true}),url:direct+'/api/planerka'};
  const fetch=loadFetchProxy(async(url,init)=>{
    calls.push({url:String(url),method:init?.method||'GET'});
    if(calls.length===1) return new Promise(()=>{});
    return ok;
  });
  await fetch('/api/planerka');
  await fetch('/api/planerka/start',{method:'POST',body:'{}'});
  assert.equal(calls.length,3);
  assert.deepEqual(calls[2],{url:direct+'/api/planerka/start',method:'POST'});
});
test('сбой прямой записи не повторяет POST через прокси', async () => {
  const direct='https://entry-encyclopedia-gmbh-career.trycloudflare.com';
  const ok={...fakeResponse(200,'application/json',{ok:true}),url:direct+'/api/planerka'};
  let posts=0;
  const fetch=loadFetchProxy(async(url,init)=>{
    if(init?.method==='POST') {posts++;throw Error('connection lost');}
    return ok;
  });
  await fetch('/api/planerka');
  await assert.rejects(fetch('/api/planerka/start',{method:'POST'}),/connection lost/);
  assert.equal(posts,1);
});
test('быстрый прокси остаётся маршрутом сохранения планёрки', async () => {
  const calls=[];
  const ok={...fakeResponse(200,'application/json',{ok:true}),url:'https://atomus-pwa.vercel.app/api/planerka'};
  const fetch=loadFetchProxy(async(url)=>{calls.push(url);return ok;});
  await fetch('/api/planerka');await fetch('/api/planerka/start',{method:'POST'});
  assert.deepEqual(calls,['/api/planerka','/api/planerka/start']);
});
