const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

function mail() {
  const context = {
    escapeHtml(value) {
      return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    },
  };
  const code = section('function _mailPrettyText(body)', 'function _mailSplitBody(body)');
  vm.runInNewContext(`${code}\nthis.pretty = _mailPrettyText; this.html = _mailBodyHtml;`, context);
  return context;
}

// Так выглядит письмо Ozon в разделе «Почта и MAX»: отступы пробелами и
// пустые строки в пол-экрана между абзацами.
const OZON = [
  '            Счет для оплаты заказа во вложении',
  '',
  '',
  '',
  '        Здравствуйте!',
  '',
  '',
  '',
  '',
  '     Оплатите заказ 0208297309-0045 от 11.08.2026 в течение 7 дней',
  '',
  '',
  '   Мы получим деньги за 4 часа, если:   ',
  '',
  '',
  '=====================',
  '',
  '  Подробности: https://seller.ozon.ru/app/finances/invoices/0208297309',
].join('\n');

test('лесенка из рассылки превращается в читаемый текст', () => {
  const { pretty } = mail();

  const out = pretty(OZON);

  assert.ok(!/\n{3,}/.test(out), 'дыр по три и более пустых строк остаться не должно');
  assert.ok(!/^[ \t]+/m.test(out), 'отступов в начале строк быть не должно');
  assert.ok(!out.includes('====='), 'линейка из символов — это вёрстка, а не текст');
  assert.ok(out.startsWith('Счет для оплаты заказа во вложении'));
  assert.ok(out.includes('Оплатите заказ 0208297309-0045'), 'смысл письма на месте');
});

test('пустое и странное не роняет письмо', () => {
  const { pretty } = mail();

  assert.equal(pretty(''), '');
  assert.equal(pretty(null), '');
  assert.equal(pretty('   \n\n   \n'), '');
});

test('короткая черта — это текст, а не разделитель', () => {
  const { pretty } = mail();

  assert.equal(pretty('Итого\n---\n100 ₽').includes('---'), false);
  assert.ok(pretty('Скидка\n-\n5%').includes('-'), 'одиночный дефис оставляем');
});

test('ссылки становятся кликабельными и укорачиваются', () => {
  const { html } = mail();

  const out = html('Счёт: https://seller.ozon.ru/app/finances/invoices/0208297309 — оплатите');

  assert.match(out, /<a href="https:\/\/seller\.ozon\.ru\/app\/finances\/invoices\/0208297309" target="_blank" rel="noopener noreferrer">/);
  assert.ok(out.includes('— оплатите'), 'текст вокруг ссылки сохраняется');
});

test('чужой html в письме не выполняется, а показывается как текст', () => {
  const { html } = mail();

  const out = html('<img src=x onerror=alert(1)> и <script>alert(2)</script>');

  assert.ok(!out.includes('<img'), 'теги из письма должны быть экранированы');
  assert.ok(!out.includes('<script'), 'скрипту в письме взяться неоткуда');
  assert.ok(out.includes('&lt;script&gt;'));
});

test('точка с запятой в конце ссылки не утаскивается внутрь', () => {
  const { html } = mail();

  const out = html('Тут: https://example.com/a?b=1, дальше текст');

  assert.match(out, /href="https:\/\/example\.com\/a\?b=1"/);
  assert.ok(out.includes(', дальше текст'));
});

test('переписка рисует письмо через новый вывод, а не сырым текстом', () => {
  assert.match(source, /class="mm-body">' \+ _mailBodyHtml\(parts\.main/);
  assert.match(source, /_mailSplitBody\(_mailPrettyText\(m\.body \|\| ''\)\)/);
});
