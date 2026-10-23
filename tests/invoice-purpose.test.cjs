const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app-3.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

// Окно «на что этот счёт» — сама модалка живёт на DOM, поэтому проверяем
// разметку и то, как ответ доходит до сервера.
function purposeCtx() {
  const el = { innerHTML: '', className: '', id: '', remove() { el.removed = true; }, set onclick(v) {} };
  const input = { value: '', focus() {}, set onkeydown(v) { input._key = v; } };
  const context = {
    document: {
      createElement: () => el,
      getElementById: (id) => (id === 'inv-purpose-input' ? input : null),
      body: { appendChild() {} },
    },
    escapeHtml: (v) => String(v == null ? '' : v),
    window: {},
    apiPost(url, body) { context.posted = { url, body }; return Promise.resolve({}); },
  };
  const code = section('// ============ v2.45.888: «НА ЧТО ЭТОТ СЧЁТ»',
                       'async function sendInboxToPay(');
  vm.runInNewContext(
    `${code}\nthis.ask = askInvoicePurpose; this.save = saveInvoicePurpose;`,
    context
  );
  context.window = context;   // в браузере окно и глобальный объект — одно и то же
  context._el = el;
  context._input = input;
  return context;
}

test('окно спрашивает то же, что бот MAX, и предлагает примеры', async () => {
  const c = purposeCtx();

  c.ask({ title: 'Передать счёт на оплату', current: 'ТО Машины' });

  assert.match(c._el.innerHTML, /На что этот счёт\?/);
  assert.match(c._el.innerHTML, /value="ТО Машины"/, 'уже записанное назначение подставлено');
  assert.match(c._el.innerHTML, /ТО Машины<\/button>/, 'есть быстрые подсказки');
  assert.match(c._el.innerHTML, /Бухгалтер увидит это в «На оплату»/);
  assert.match(css, /\.inv-purpose-hints\{/);
});

test('ответ возвращается строкой, отмена — null', async () => {
  const c = purposeCtx();

  const answer = c.ask({});
  c._input.value = '  Ремонт компрессора  ';
  c._invPurposeSubmit();
  assert.equal(await answer, 'Ремонт компрессора', 'лишние пробелы срезаются');

  const cancelled = c.ask({});
  c._invPurposeDone(null);
  assert.equal(await cancelled, null);
});

test('пустой ответ — это «отправить как есть», а не отмена', async () => {
  const c = purposeCtx();

  const answer = c.ask({});
  c._input.value = '';
  c._invPurposeSubmit();

  assert.equal(await answer, '');
});

test('назначение уходит туда же, куда пишет MAX', async () => {
  const c = purposeCtx();

  await c.save(42, 'Хозработы');

  assert.equal(c.posted.url, '/api/supply-inbox/42/comment');
  assert.deepEqual(JSON.parse(JSON.stringify(c.posted.body)), { comment: 'Хозработы' });
});

test('без письма назначение сохранять некуда — молча пропускаем', async () => {
  const c = purposeCtx();

  await c.save(null, 'Хозработы');

  assert.equal(c.posted, undefined);
});

test('обе кнопки оплаты сначала спрашивают назначение', () => {
  const pay = source.slice(source.indexOf('async function payInboxOrderToPay('),
    source.indexOf('async function payInboxOrderToPay(') + 1200);
  const send = section('async function sendInboxToPay(', 'async function payInboxOrderToPay(');

  for (const fn of [pay, send]) {
    assert.match(fn, /await askInvoicePurpose\(/);
    assert.match(fn, /if \(purpose === null\) return;/, 'отмена не отправляет счёт');
    assert.match(fn, /await saveInvoicePurpose\(inboxId, purpose\)/);
  }
  // в разметке кнопок передаём id письма и уже записанное назначение
  assert.match(source, /payInboxOrderToPay\(' \+ m\.matched_order_id[^\n]*m\.id[^\n]*user_comment/);
  assert.match(source, /sendInboxToPay\(' \+ m\.id \+ ',null,' \+ JSON\.stringify\(m\.user_comment/);
});
