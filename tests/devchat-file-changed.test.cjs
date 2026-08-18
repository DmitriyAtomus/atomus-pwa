// «Не ушло: связь оборвалась» при живой связи. Браузер читает файл с диска в
// момент отправки: если архив перепаковали тем же именем после того, как его
// прикрепили, XHR падает сетевой ошибкой — и человек ищет проблему в интернете.
// Проверяем, что такой файл называется своим именем ДО загрузки, а настоящий
// обрыв получает второй заход.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

const MB = 1024 * 1024;

// Файл, который читается — или уже нет (перепакован, перенесён, флешку вынули)
function fakeFile(name, size, readable) {
  return {
    name, size,
    slice() {
      return { arrayBuffer: async () => {
        if (!readable) throw new Error('NotReadableError');
        return new ArrayBuffer(1);
      } };
    },
  };
}

function xhrClass(ctx) {
  return class {
    constructor() { this.upload = {}; this.status = 0; this.responseText = ''; }
    open(method, url) { ctx.calls.push({ method, url }); }
    setRequestHeader() {}
    send() {
      if (this.upload.onprogress) {
        this.upload.onprogress({ lengthComputable: true, loaded: 62, total: 100 });
      }
      if (ctx.plan.failTimes && ctx.calls.length <= ctx.plan.failTimes) { this.onerror(); return; }
      if (ctx.plan.fail) { this.onerror(); return; }
      this.status = 201;
      this.responseText = '{"ok":true,"message":{}}';
      this.onload();
    }
  };
}

function sendContext(opts) {
  const o = opts || {};
  const files = o.files || [];
  const ctx = {
    toasts: [], calls: [], ticks: 0,
    plan: o.plan || {},
    btn: { disabled: false, innerHTML: '', textContent: '', classList: { list: new Set(),
      add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); } } },
    input: { value: 'посмотри, как мы оформляем' },
    state: { currentScreen: 'devchat' },
    localStorage: { getItem: () => 'tok' },
    FormData: class { append() {} },
    showToast(msg, type) { ctx.toasts.push({ msg, type }); },
    devChatGrow() {},
    devChatJump() {},
    devChatLoadThreads() {},
    _devChatTick: async () => { ctx.ticks += 1; },
    Math, JSON, Promise, Error,
  };
  ctx.XMLHttpRequest = xhrClass(ctx);
  ctx.__files = files;
  const code = section('// Сколько принимает сервер', '// ---------------- чаты (треды) и проекты');
  vm.runInNewContext(
    'const API_BASE = "https://api";\nconst API_DIRECT_FALLBACK = "https://railway";\n' +
    'const TOKEN_KEY = "t";\n' +
    'let _devChatBusy = false;\nlet _devChatThreadId = 5;\n' +
    'let _devChatFiles = this.__files;\n' +
    'function _devChatEl(name) { return name === "send" ? this.btn : (name === "input" ? this.input : null); }\n' +
    'function _devChatApi(p) { return "/api/dev-chat" + p; }\n' +
    'function _devChatDraftClear() {}\n' +
    'function devChatPickFiles(f) { _devChatFiles = f || []; }\n' +
    'function _devChatSendable() {}\n' +
    code +
    '\nthis.send = devChatSend;\nthis.files = function () { return _devChatFiles; };',
    ctx);
  return ctx;
}

test('перепакованный архив не гонят в сеть — говорят про файл', async () => {
  const ctx = sendContext({ files: [fakeFile('AG-39.000.000СБ Кронштейн.zip', 38 * MB, false)] });

  await ctx.send();

  assert.equal(ctx.calls.length, 0, 'незачем грузить 38 МБ, которые всё равно оборвутся');
  assert.match(ctx.toasts[0].msg, /AG-39\.000\.000СБ Кронштейн\.zip/);
  assert.match(ctx.toasts[0].msg, /изменили, перенесли или удалили/);
  assert.match(ctx.toasts[0].msg, /прикрепи заново/);
  assert.equal(ctx.toasts[0].type, 'error');
  assert.equal(ctx.files().length, 1, 'вложение остаётся в композере');
});

test('читаемый файл уходит как раньше', async () => {
  const ctx = sendContext({ files: [fakeFile('kd.zip', 3 * MB, true)] });

  await ctx.send();

  assert.deepEqual(ctx.calls[0], { method: 'POST', url: 'https://api/api/dev-chat/send' });
  assert.equal(ctx.ticks, 1, 'лента обновилась');
});

test('случайный обрыв — второй заход молча, без потери вложения', async () => {
  const ctx = sendContext({
    files: [fakeFile('kd.zip', 3 * MB, true)],
    plan: { failTimes: 1 },
  });

  await ctx.send();

  assert.equal(ctx.calls.length, 2, 'первая попытка оборвалась, вторая ушла');
  assert.match(ctx.toasts[0].msg, /оборвалась на 62% — пробую ещё раз/);
  assert.notEqual(ctx.toasts[0].type, 'error', 'это не отказ, а сообщение о повторе');
  assert.equal(ctx.ticks, 1, 'сообщение в итоге в ленте');
  assert.equal(ctx.files().length, 0, 'вложения сброшены после успеха');
});

test('оборвалось дважды — говорим, докуда доехало, и всё сохраняем', async () => {
  const ctx = sendContext({ files: [fakeFile('kd.zip', 3 * MB, true)], plan: { fail: true } });

  await ctx.send();

  assert.equal(ctx.calls.length, 2);
  const last = ctx.toasts[ctx.toasts.length - 1];
  assert.match(last.msg, /Не ушло: связь оборвалась на 62%/);
  assert.equal(last.type, 'error');
  assert.equal(ctx.input.value, 'посмотри, как мы оформляем', 'текст на месте');
  assert.equal(ctx.files().length, 1, 'вложение на месте');
  assert.equal(ctx.btn.disabled, false, 'кнопка снова доступна');
});
