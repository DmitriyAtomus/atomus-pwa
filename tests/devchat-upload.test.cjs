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
    getResponseHeader(name) {
      return String(name).toLowerCase() === 'content-type'
        ? (this.plan.contentType || 'application/json') : '';
    }
    send() {
      const plan = Array.isArray(ctx.plan)
        ? (ctx.plan[Math.min(ctx.calls.length - 1, ctx.plan.length - 1)] || {})
        : ctx.plan;
      this.plan = plan;
      if (this.upload.onprogress) {
        const part = plan.progress === undefined ? 0.5 : plan.progress;
        this.upload.onprogress({ lengthComputable: true, loaded: part * 10, total: 10 });
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
    'const API_BASE = "https://api";\n' +
    'const API_DIRECT_FALLBACK = "https://railway";\nconst TOKEN_KEY = "t";\n' +
    'let _devChatBusy = false;\nlet _devChatThreadId = 5;\n' +
    'let _devChatFiles = ' + JSON.stringify(o.files || []) + ';\n' +
    'function _devChatEl(name) { return name === "send" ? this.btn : (name === "input" ? this.input : null); }\n' +
    'function _devChatApi(p) { return "/api/dev-chat" + p; }\n' +
    'function _devChatEmployeeMode() { return ' + (o.employee ? 'true' : 'false') + '; }\n' +
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

// У сотрудника Клава только читает приложенное: свои пределы и свой список
// типов (employee_chat.py). Отказ должен приходить до загрузки, а не после.
test('сотруднику отбивается файл, который Клава не прочитает', async () => {
  const ctx = sendContext({ employee: true, files: [{ name: 'узел.zip', size: 2 * MB }] });

  await ctx.send();

  assert.equal(ctx.calls.length, 0);
  assert.match(ctx.toasts[0].msg, /узел\.zip/);
  assert.match(ctx.toasts[0].msg, /прочитать не сможет/);
});

test('сотруднику фото ограничено 8 МБ, а вложения за раз — 40 МБ', async () => {
  const heavy = sendContext({ employee: true, files: [{ name: 'цех.jpg', size: 12 * MB, type: 'image/jpeg' }] });
  await heavy.send();
  assert.equal(heavy.calls.length, 0);
  assert.match(heavy.toasts[0].msg, /8\.0 МБ/);
  assert.match(heavy.toasts[0].msg, /полегче/, 'архив сотруднику предлагать нечего');

  const many = sendContext({
    employee: true,
    files: [1, 2, 3].map((i) => ({ name: `смета${i}.xlsx`, size: 18 * MB })),
  });
  await many.send();
  assert.equal(many.calls.length, 0);
  assert.match(many.toasts[0].msg, /40 МБ/);
});

test('сотруднический счёт-PDF уходит на свой адрес', async () => {
  const ctx = sendContext({ employee: true, files: [{ name: 'счёт.pdf', size: 2 * MB }] });

  await ctx.send();

  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.toasts.length, 0);
});

test('обрыв связи больше не молчит, а текст остаётся в поле', async () => {
  const ctx = sendContext({ files: [{ name: 'kd.zip', size: 3 * MB }], plan: { fail: true } });

  await ctx.send();

  assert.equal(ctx.calls.length, 2, 'после обрыва пробуем ещё раз сами');
  assert.match(ctx.toasts[ctx.toasts.length - 1].msg, /связь оборвалась/i);
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

test('HTML 403 от Vercel повторяется напрямую в Railway', async () => {
  const ctx = sendContext({
    files: [{ name: 'скриншот.png', size: 2 * MB }],
    plan: [
      { status: 403, contentType: 'text/html; charset=utf-8', body: '<!doctype html>' },
      { status: 201, contentType: 'application/json' },
    ],
  });

  await ctx.send();

  assert.deepEqual(ctx.calls, [
    { method: 'POST', url: 'https://api/api/dev-chat/send' },
    { method: 'POST', url: 'https://railway/api/dev-chat/send' },
  ]);
  assert.equal(ctx.ticks, 1, 'после прямого повтора сообщение появилось в ленте');
  assert.equal(ctx.files().length, 0, 'вложение убралось только после успешной отправки');
});

test('JSON 403 backend не повторяется в обход сервера', async () => {
  const ctx = sendContext({
    plan: {
      status: 403,
      contentType: 'application/json',
      body: '{"error":"forbidden","message":"Личный чат владельца"}',
    },
  });

  await ctx.send();

  assert.equal(ctx.calls.length, 1);
  assert.match(ctx.toasts[0].msg, /Личный чат владельца/);
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

// Проверка Vercel под VPN обычно не отвечает 403, а рвёт соединение, пока тело
// ещё едет: браузер видит сетевую ошибку на 0%. Раньше такой отказ дважды бился
// в тот же адрес и заканчивался «связь оборвалась» при живом интернете.
test('соединение закрыли на старте — повторяем сразу в Railway', async () => {
  const ctx = sendContext({
    files: [{ name: 'скриншот.jpg', size: 2 * MB }],
    plan: [
      { fail: true, progress: 0 },
      { status: 201, contentType: 'application/json' },
    ],
  });

  await ctx.send();

  assert.deepEqual(ctx.calls, [
    { method: 'POST', url: 'https://api/api/dev-chat/send' },
    { method: 'POST', url: 'https://railway/api/dev-chat/send' },
  ]);
  assert.equal(ctx.ticks, 1, 'сообщение всё-таки ушло');
  assert.equal(ctx.files().length, 0);
});

test('обрыв посреди загрузки не гонят вторым адресом', async () => {
  // 40 МБ дошли до половины и связь дрогнула — это не отказ края, второй адрес
  // тут только удвоит трафик. Повтор идёт в тот же самый.
  const ctx = sendContext({
    files: [{ name: 'kd.zip', size: 40 * MB }],
    plan: [
      { fail: true, progress: 0.5 },
      { status: 201, contentType: 'application/json' },
    ],
  });

  await ctx.send();

  assert.deepEqual(ctx.calls.map((c) => c.url), [
    'https://api/api/dev-chat/send',
    'https://api/api/dev-chat/send',
  ]);
});

test('если и обход не прошёл — говорим про VPN, а не про связь', async () => {
  const ctx = sendContext({
    files: [{ name: 'скриншот.jpg', size: 2 * MB }],
    plan: { fail: true, progress: 0 },
  });

  await ctx.send();

  assert.equal(ctx.calls.length, 4, 'два захода, в каждом — прокси и прямой адрес');
  const last = ctx.toasts[ctx.toasts.length - 1];
  assert.match(last.msg, /VPN/);
  assert.doesNotMatch(last.msg, /связь оборвалась/i);
  assert.equal(last.type, 'error');
  assert.equal(ctx.input.value, 'посмотри архив', 'написанное не теряется');
  assert.equal(ctx.files().length, 1, 'вложение на месте');
});
