// v2.45.972: файлы перетаскиванием прямо в чат с Клавой.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

function dropContext(opts) {
  const o = opts || {};
  const ctx = {
    toasts: [], sends: 0, focused: 0, drawerOpen: !!o.drawerOpen,
    state: { currentScreen: o.screen === undefined ? 'devchat' : o.screen },
    Date,
    File,
    setInterval() { return 0; },
    clearInterval() {},
    showToast(msg, type) { ctx.toasts.push({ msg, type }); },
    plural(n, one, few, many) {
      const m10 = n % 10, m100 = n % 100;
      if (m10 === 1 && m100 !== 11) return one;
      if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
      return many;
    },
    devChatSend() { ctx.sends += 1; },
    document: {
      getElementById(id) {
        if (id === 'devchat-drawer') return { style: { display: ctx.drawerOpen ? 'flex' : 'none' } };
        if (id === 'devchat-input' || id === 'devchat-drawer-input') return { focus() { ctx.focused += 1; } };
        return null;
      },
      querySelector() { return null; },
    },
  };
  const code = section('function devChatPickFiles(files)', '// Вложения показываем плиткой');
  const hostEl = section('function _devChatEl(name)', 'const _DEVCHAT_STATUS');
  vm.runInNewContext(
    'let _devChatFiles = [];\nlet _devChatHost = "screen";\n' + hostEl + code +
    '\nfunction _devChatDrawFiles() {}\n' +
    'this.take = _devChatDropTake;\nthis.host = _devChatDropHost;\nthis.isFiles = _devChatDropIsFiles;\n' +
    'this.picked = function () { return _devChatFiles; };\nthis.activeHost = function () { return _devChatHost; };',
    ctx);
  return ctx;
}

function transfer(names) {
  return { types: ['Files'], files: names.map((n) => ({ name: n, type: n.endsWith('.png') ? 'image/png' : 'text/plain' })) };
}

test('брошенные файлы прикрепляются, но сами не улетают', () => {
  const ctx = dropContext();

  ctx.take(transfer(['схема.png', 'лог.txt']), false);

  assert.deepEqual(JSON.parse(JSON.stringify(ctx.picked().map((f) => f.name))), ['схема.png', 'лог.txt']);
  assert.equal(ctx.sends, 0, 'без зоны «отправить сразу» сообщение ждёт человека');
  assert.equal(ctx.focused, 1, 'курсор встаёт в поле — можно дописать задачу');
  assert.match(ctx.toasts[0].msg, /Прикрепил 2 файла/);
});

test('бросок в зону «отправить сразу» уходит Клаве без лишних нажатий', () => {
  const ctx = dropContext();

  ctx.take(transfer(['экран.png']), true);

  assert.equal(ctx.sends, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.picked().map((f) => f.name))), ['экран.png']);
});

test('перетаскивание без файлов объясняет, что случилось', () => {
  const ctx = dropContext();

  ctx.take({ types: ['Files'], files: [] }, true);

  assert.equal(ctx.sends, 0, 'пустое сообщение не отправляется');
  assert.match(ctx.toasts[0].msg, /Файлов в перетаскивании не оказалось/);
  assert.equal(ctx.toasts[0].type, 'error');
});

test('при открытой шторке файлы кладутся в её композер, а не в экранный', () => {
  const ctx = dropContext({ drawerOpen: true, screen: 'orders' });

  assert.ok(ctx.host(), 'шторка ловит перетаскивание поверх любого раздела');
  ctx.take(transfer(['счёт.pdf']), false);

  assert.equal(ctx.activeHost(), 'drawer');
});

test('лимит в пять файлов держится и на перетаскивании', () => {
  const ctx = dropContext();

  ctx.take(transfer(['1.txt', '2.txt', '3.txt', '4.txt', '5.txt', '6.txt']), false);

  assert.equal(ctx.picked().length, 5);
  assert.match(ctx.toasts.map((t) => t.msg).join(' | '), /Взял только 5/);
});

test('вне чата перетаскивание не перехватывается', () => {
  const ctx = dropContext({ screen: 'orders' });

  assert.equal(ctx.host(), null);
  assert.equal(ctx.isFiles({ dataTransfer: { types: ['text/plain'] } }), false);
});

test('приёмник виден и подключён', () => {
  // обработчики вешаются при открытии ленты — вместе со вставкой из буфера
  assert.match(source, /_devChatBindPaste\(\);\s*\n\s*_devChatBindDrop\(\);/);
  const bind = section('function _devChatBindDrop()', '// Вложения показываем плиткой');
  // без preventDefault браузер откроет брошенный файл вместо приёма в чат
  assert.match(bind, /e\.preventDefault\(\);\s+\/\/ без этого браузер откроет файл/);
  assert.match(css, /\.dchat-drop\.show \{/);
  assert.match(css, /\.dchat-drop \.dcd-go \{/);
  assert.match(html, /Файлы можно перетащить прямо в окно/);
});
