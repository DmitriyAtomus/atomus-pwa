// Крупные вложения в чате Клавы: отправка больше не молчит.
// Ловим ровно то, из-за чего 17.08 архив конструктора «не отправлялся»:
// сетевой обрыв в fetch не показывал ничего, прогресса не было видно,
// а без текста (только файл) кнопки отправки вообще не появлялось.
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

const MB = 1024 * 1024;

// Подставной XMLHttpRequest: сценарий задаёт, чем кончится отправка
function xhrClass(ctx) {
  return class {
    constructor() {
      this.upload = {};
      this.status = 0;
      this.responseText = '';
    }
    open(method, url) { ctx.calls.push({ method, url }); }
    setRequestHeader(k, v) { ctx.headers[k] = v; }
    send() {
      const plan = ctx.plan;
      if (this.upload.onprogress) {
        this.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
      }
      if (plan.fail) { this.onerror(); return; }
      this.status = plan.status;
      this.responseText = plan.body === undefined ? '{"ok":true,"message":{}}' : plan.body;
      this.onload();
    }
  };
}

function sendContext(opts) {
  const o = opts || {};
  const ctx = {
    toasts: [], calls: [], headers: {}, ticks: 0, jumps: 0,
    plan: o.plan || { status: 201 },
    btn: { disabled: false, innerHTML: '', textContent: '', classList: { list: new Set(),
      add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); } } },
    input: { value: o.text === undefined ? 'посмотри архив' : o.text, closest: () => ctx.row },
    row: { classList: { list: new Set(),
      toggle(c, on) { if (on) this.list.add(c); else this.list.delete(c); },
      has(c) { return this.list.has(c); } } },
    state: { currentScreen: 'devchat' },
    localStorage: { getItem: () => 'tok' },
    FormData: class { append() {} },
    showToast(msg, type) { ctx.toasts.push({ msg, type }); },
    devChatGrow() {},
    devChatJump() { ctx.jumps += 1; },
    devChatLoadThreads() {},
    _devChatTick: async () => { ctx.ticks += 1; },
    Math, JSON, Promise, Error,
  };
  ctx.XMLHttpRequest = xhrClass(ctx);
  const code = section('// Сколько принимает сервер', '// ---------------- чаты (треды) и проекты');
  vm.runInNewContext(
    'const API_BASE = "https://api";\nconst TOKEN_KEY = "t";\n' +
    'let _devChatBusy = false;\nlet _devChatThreadId = 5;\n' +
    'let _devChatFiles = ' + JSON.stringify(o.files || []) + ';\n' +
    'function _devChatEl(name) { return name === "send" ? this.btn : (name === "input" ? this.input : null); }\n' +
    'function _devChatApi(p) { return "/api/dev-chat" + p; }\n' +
    'function _devChatDraftClear() {}\n' +
    'function devChatPickFiles(f) { _devChatFiles = f || []; }\n' +
    'function _devChatSendable() { this.row.classList.toggle("has-text", !!(this.input.value || "").trim() || _devChatFiles.length > 0); }\n' +
    code +
    '\nthis.send = devChatSend;\nthis.tooBig = _devChatTooBig;\nthis.mb = _devChatMB;\n' +
    'this.files = function () { return _devChatFiles; };',
    ctx);
  return ctx;
}

test('файл сверх предела отбивается сразу, с именем и весом', async () => {
  const ctx = sendContext({ files: [{ name: 'AG-39.000.000СБ.zip', size: 64 * MB }] });

  await ctx.send();

  assert.equal(ctx.calls.length, 0, 'незачем гнать 64 МБ, чтобы услышать отказ');
  assert.match(ctx.toasts[0].msg, /AG-39\.000\.000СБ\.zip/);
  assert.match(ctx.toasts[0].msg, /64 МБ/);
  assert.match(ctx.toasts[0].msg, /50 МБ/);
  assert.equal(ctx.toasts[0].type, 'error');
});

test('сумма вложений тоже ограничена', async () => {
  const files = [1, 2, 3].map((i) => ({ name: `часть${i}.zip`, size: 25 * MB }));
  const ctx = sendContext({ files });

  await ctx.send();

  assert.equal(ctx.calls.length, 0);
  assert.match(ctx.toasts[0].msg, /75 МБ/);
  assert.match(ctx.toasts[0].msg, /60 МБ/);
});

test('обрыв связи больше не молчит, а текст остаётся в поле', async () => {
  const ctx = sendContext({ files: [{ name: 'kd.zip', size: 3 * MB }], plan: { fail: true } });

  await ctx.send();

  assert.equal(ctx.calls.length, 1, 'попытка отправки была');
  assert.match(ctx.toasts[0].msg, /связь оборвалась/);
  assert.equal(ctx.input.value, 'посмотри архив', 'написанное не теряется');
  assert.equal(ctx.files().length, 1, 'вложение тоже на месте');
  assert.equal(ctx.btn.disabled, false, 'кнопка снова доступна');
  assert.equal(ctx.btn.innerHTML, '<i class="ti ti-arrow-up"></i>', 'на кнопке снова стрелка');
});

test('отказ сервера показывается его словами', async () => {
  const ctx = sendContext({
    files: [{ name: 'kd.zip', size: 3 * MB }],
    plan: { status: 400, body: '{"error":"validation","message":"«kd.zip» больше 50 МБ"}' },
  });

  await ctx.send();

  assert.match(ctx.toasts[0].msg, /«kd\.zip» больше 50 МБ/);
});

test('пока файл едет, на кнопке проценты', async () => {
  const seen = [];
  const ctx = sendContext({ files: [{ name: 'kd.zip', size: 3 * MB }] });
  const origAdd = ctx.btn.classList.add.bind(ctx.btn.classList);
  ctx.btn.classList.add = (c) => { seen.push(ctx.btn.textContent || c); origAdd(c); };

  await ctx.send();

  assert.match(seen.join(' '), /upl/, 'класс процентов включался');
  assert.equal(ctx.btn.innerHTML, '<i class="ti ti-arrow-up"></i>', 'после отправки — снова стрелка');
  assert.equal(ctx.ticks, 1, 'лента обновилась');
  assert.equal(ctx.files().length, 0, 'вложения сброшены');
});

test('успешная отправка уходит с токеном на нужный адрес', async () => {
  const ctx = sendContext({});

  await ctx.send();

  assert.deepEqual(ctx.calls[0], { method: 'POST', url: 'https://api/api/dev-chat/send' });
  assert.equal(ctx.headers.Authorization, 'Bearer tok');
});

test('прикрепил файл без текста — кнопка отправки есть', () => {
  // has-text включает стрелку вместо микрофона; раньше он смотрел только на текст
  const code = section('function _devChatSendable()', 'function _devChatChipsFade');
  assert.match(code, /_devChatFiles\.length > 0/);
  assert.match(source, /function _devChatDrawFiles\(\) \{\s*\n\s*_devChatSendable\(\);/);
  assert.match(css, /\.dchat-send\.upl \{/);
});

test('в диалоге выбора видны архивы, а не только картинки', () => {
  // accept="image/*,.pdf,…" прятал zip со STEP/DXF от конструктора
  const inputs = html.match(/<input type="file" id="devchat(-drawer)?-file-input"[^>]*>/g) || [];
  assert.equal(inputs.length, 2, 'композер на экране и в шторке');
  inputs.forEach((tag) => assert.doesNotMatch(tag, /accept=/));
});

test('предел на клиенте совпадает с серверным', () => {
  const ctx = sendContext({});
  assert.equal(ctx.mb(50 * MB), '50 МБ');
  assert.match(source, /const DEVCHAT_MAX_FILE = 50 \* 1024 \* 1024;/);
  assert.match(source, /const DEVCHAT_MAX_TOTAL = 60 \* 1024 \* 1024;/);
});
