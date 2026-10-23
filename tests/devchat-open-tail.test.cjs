// v2.45.1015: чат открывается на ПОСЛЕДНИХ репликах.
// До этого лента просила «всё, что новее нуля», а сервер отдавал первые 200
// сообщений. В чате «Чиллера» их 369: открывался кусок недельной давности,
// следующий тик через три секунды дорисовывал хвост и прыгал вниз — переписка
// на глазах перелистывалась. Теперь при открытии берём хвост, а история
// догружается вверх страницами.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('открытие ленты просит хвост, а не начало переписки', () => {
  const fn = app.slice(app.indexOf('async function _devChatTickInner'));
  assert.match(fn.slice(0, 1200), /\(first \? '&tail=' \+ DEVCHAT_TAIL : ''\)/,
    'без tail сервер отдаёт первые 200 сообщений — лента открывается в прошлом');
  assert.match(app, /const DEVCHAT_TAIL = \d+;/);
  // курсор истории ставится по первой пришедшей реплике
  assert.match(fn.slice(0, 3000), /_devChatOldest = msgs\.length \? msgs\[0\]\.id : 0;/);
  assert.match(fn.slice(0, 3000), /_devChatHasOlder = !!\(data && data\.has_older\);/);
});

test('история догружается вверх — и не сдвигает то, что читаешь', () => {
  const fn = app.slice(app.indexOf('async function devChatLoadOlder'),
                       app.indexOf('// Кнопка «вниз» нужна'));
  assert.match(fn, /'\?before_id=' \+ _devChatOldest/, 'догрузка идёт по before_id');
  assert.match(fn, /const anchorH = feed\.scrollHeight;/);
  assert.match(fn, /feed\.scrollTo\(\{ top: anchorTop \+ grew, behavior: 'auto' \}\)/,
    'без возврата в ту же точку лента прыгает под руками при догрузке');
  assert.match(fn, /_devChatOlderBusy = false;/, 'замок догрузки должен сниматься');
  // догруженная история не должна «въезжать» анимацией
  assert.match(fn, /row\.classList\.add\('no-anim'\)/);
});

test('автодогрузка не срабатывает, пока лента короче экрана', () => {
  const fn = app.slice(app.indexOf('function devChatOnScroll'));
  assert.match(fn.slice(0, 800), /feed\.scrollHeight > feed\.clientHeight \+ 40/,
    'при нулевом scrollTop короткой ленты история грузилась бы страница за страницей');
});

test('смена чата и открытие раздела обнуляют курсор истории', () => {
  const open = app.slice(app.indexOf('function loadDevChat(host)'));
  assert.match(open.slice(0, 900), /_devChatOldest = 0;/);
  const thread = app.slice(app.indexOf('function devChatOpenThread(id)'));
  assert.match(thread.slice(0, 1200), /_devChatOldest = 0;/);
  assert.match(thread.slice(0, 1200), /_devChatHasOlder = false;/);
});

test('первая пачка появляется без анимации въезда', () => {
  assert.match(app, /if \(first\) row\.classList\.add\('no-anim'\);/);
  assert.match(css, /\.dchat-row\.no-anim \{ animation: none; \}/);
});

// ---- разделители дней ----
// Раньше день вели одним курсором сверху вниз. Догрузка вставляет сообщения
// ВЫШЕ нарисованных, поэтому разделители пересобираются по всей ленте.
function dayContext() {
  const code = app.slice(app.indexOf('// Ключ дня для разделителя'),
                         app.indexOf('// «Клава работает» — три точки'));
  assert.ok(code.length > 100, 'секция разделителей дня не найдена');

  function el(tag) {
    return {
      tagName: tag, className: '', innerHTML: '', attrs: {}, children: [],
      parent: null,
      classList: {
        add(c) { this.owner.className = (this.owner.className + ' ' + c).trim(); },
        contains(c) { return this.owner.className.split(/\s+/).includes(c); },
      },
      setAttribute(n, v) { this.attrs[n] = String(v); },
      getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; },
      appendChild(kid) { kid.parent = this; this.children.push(kid); return kid; },
      insertBefore(kid, ref) {
        kid.parent = this;
        const i = ref ? this.children.indexOf(ref) : -1;
        if (i < 0) this.children.push(kid); else this.children.splice(i, 0, kid);
        return kid;
      },
      remove() {
        if (!this.parent) return;
        const i = this.parent.children.indexOf(this);
        if (i >= 0) this.parent.children.splice(i, 1);
      },
      querySelectorAll(sel) {
        return this.children.filter(function (c) {
          if (sel === '.dchat-day') return c.classList.contains('dchat-day');
          if (sel === '.dchat-row[data-ts]') {
            return c.classList.contains('dchat-row') && c.getAttribute('data-ts');
          }
          throw new Error('селектор в тесте не поддержан: ' + sel);
        });
      },
    };
  }
  function make(tag) {
    const node = el(tag);
    node.classList.owner = node;
    return node;
  }

  const context = {
    escapeHtml: (v) => String(v == null ? '' : v),
    document: { createElement: make },
    _devChatDayKey: '',
  };
  vm.runInNewContext(`${code}\nthis.sync = _devChatSyncDays;\nthis.day = _devChatDay;`, context);
  context.make = make;
  return context;
}

function row(ctx, ts) {
  const r = ctx.make('div');
  r.className = 'dchat-row';
  r.setAttribute('data-ts', ts);
  return r;
}

test('разделитель дня — один на день, даже после догрузки истории', () => {
  const ctx = dayContext();
  const feed = ctx.make('div');
  const today = new Date();
  const iso = (d, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).toISOString();
  const yesterday = new Date(today.getTime() - 86400000);

  // на экране — только сегодняшний хвост
  feed.appendChild(row(ctx, iso(today, 9)));
  feed.appendChild(row(ctx, iso(today, 10)));
  ctx.sync(feed);
  let days = feed.children.filter((c) => c.className === 'dchat-day');
  assert.equal(days.length, 1, 'на один день — один разделитель');

  // догрузили вчерашнее и утреннее сегодняшнее ВЫШЕ нарисованного
  feed.insertBefore(row(ctx, iso(today, 8)), feed.children[0]);
  feed.insertBefore(row(ctx, iso(yesterday, 18)), feed.children[0]);
  ctx.sync(feed);
  days = feed.children.filter((c) => c.className === 'dchat-day');
  assert.equal(days.length, 2, 'должно остаться ровно два дня: вчера и сегодня');
  // разделители стоят перед первым сообщением своих суток
  const order = feed.children.map((c) => (c.className === 'dchat-day' ? 'day' : 'msg'));
  assert.deepEqual(order, ['day', 'msg', 'day', 'msg', 'msg', 'msg']);
});
