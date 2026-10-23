const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

// Утреннее окно поднимается из showApp(); нас интересует, спрашивает ли оно сервер.
function ctx(opts) {
  const o = opts || {};
  const context = {
    state: { user: { roles: ['master'] }, isDesktop: true },
    localStorage: {
      _v: o.local || {},
      getItem(k) { return this._v[k] || null; },
      setItem(k, v) { this._v[k] = v; },
    },
    document: { getElementById: () => null, body: { style: {} } },
    _isShevelevMaster: () => false,
    _renderMorningProgress(active, gaps) { context.rendered = { active, gaps }; },
    async apiGet(url) {
      context.gets = (context.gets || []).concat(url);
      if (url === '/api/production/morning-checkin') {
        if (o.checkinFails) throw new Error('сервер молчит');
        return o.checkin || { day: '2026-08-05', shown: false, submitted: false };
      }
      if (url.startsWith('/api/production/works')) return { works: o.works || [] };
      if (url === '/api/production/day-gaps') return o.gaps || {};
      return {};
    },
    apiPost(url, body) {
      context.posts = (context.posts || []).concat({ url, body });
      return Promise.resolve({});
    },
  };
  const code = section('const MORNING_PROGRESS_KEY', 'function _renderMorningProgress(active, gaps)');
  vm.runInNewContext(`${code}\nthis.maybe = _maybeMorningProgress;`, context);
  return context;
}

const WORK = { id: 5, status: 'in_progress', progress: 40 };

test('ответил с планшета — на компьютере окно не всплывает', async () => {
  const c = ctx({ checkin: { submitted: true, shown: true }, works: [WORK] });

  await c.maybe();

  assert.equal(c.rendered, undefined);
  assert.ok(c.gets.includes('/api/production/morning-checkin'), 'состояние спрошено у сервера');
});

test('открыли на планшете, но не заполнили — на компьютере спросим снова', async () => {
  // иначе за день не останется ни процентов, ни ответов по людям
  const c = ctx({ checkin: { submitted: false, shown: true }, works: [WORK] });

  await c.maybe();

  assert.ok(c.rendered, 'вопросы всё же заданы');
});

test('на том же устройстве окно не всплывает при каждой перезагрузке', async () => {
  const day = new Date();
  const key = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') +
    '-' + String(day.getDate()).padStart(2, '0');
  const store = {}; store[key] = { _shown: true };
  const c = ctx({
    checkin: { submitted: false, shown: true }, works: [WORK],
    local: { atomus_morning_progress_v1: JSON.stringify(store) },
  });

  await c.maybe();

  assert.equal(c.rendered, undefined);
});

test('сегодня ещё не отвечали — окно показывается и отмечается на сервере', async () => {
  const c = ctx({ checkin: { submitted: false, shown: false }, works: [WORK] });

  await c.maybe();

  assert.ok(c.rendered, 'окно показано');
  const shown = (c.posts || []).find(p => p.body && p.body.event === 'shown');
  assert.ok(shown, 'сервер узнал, что окно открыли');
  assert.equal(shown.url, '/api/production/morning-checkin');
  assert.equal(shown.body.device, 'компьютер');
});

test('сервер недоступен — работаем по памяти устройства, как раньше', async () => {
  const shownToday = {};
  const day = new Date();
  const key = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') +
    '-' + String(day.getDate()).padStart(2, '0');
  shownToday[key] = { _shown: true };
  const c = ctx({
    checkinFails: true, works: [WORK],
    local: { atomus_morning_progress_v1: JSON.stringify(shownToday) },
  });

  await c.maybe();

  assert.equal(c.rendered, undefined, 'локальная память всё ещё глушит повтор');
});

test('«Начать смену» отмечается на сервере', () => {
  const submit = section('function _mpSubmit()', '// ============================================================================');

  assert.match(submit, /apiPost\('\/api\/production\/morning-checkin', \{ event: 'submitted'/);
  // проценты и ответы по людям как уходили на сервер, так и уходят
  assert.match(submit, /\/api\/production\/works\/' \+ w\.id \+ '\/progress/);
  assert.match(submit, /\/api\/production\/day-answers/);
});

test('с планшета в базу пишется, что отвечали с планшета', () => {
  const c = ctx({});
  c.state.isDesktop = false;
  const code = section('function _mpDevice()', 'function _mpLoadStore()');
  const box = { state: { isDesktop: false } };
  vm.runInNewContext(`${code}\nthis.dev = _mpDevice;`, box);

  assert.equal(box.dev(), 'телефон/планшет');
});
