const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'app-3.js'),
  'utf8'
);

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

test('СДЭК разделён на входящие и исходящие отправления', () => {
  const code = section(
    'function _cdekStatusChip(sh)',
    'function cdekAdd()'
  );
  const context = {
    escapeHtml(value) {
      return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    },
    _logiEtaTile(value) {
      return `<time>${value}</time>`;
    },
  };
  vm.runInNewContext(`${code}\nthis.render = _cdekBlockHtml;`, context);

  const html = context.render({
    configured: true,
    shipments: [
      {
        id: 1,
        cdek_number: '11111111111',
        direction: 'incoming',
        sender_name: 'ООО Поставщик',
        recipient_name: 'ООО Атомус',
        sync_error: 'Entity is forbidden abc-123',
      },
      {
        id: 2,
        cdek_number: '22222222222',
        direction: 'outgoing',
        sender_name: 'ООО Атомус',
        recipient_name: 'ООО Клиент',
      },
    ],
  });

  assert.match(html, /К нам/);
  assert.match(html, /От нас/);
  assert.match(html, /cdek-card incoming/);
  assert.match(html, /cdek-card outgoing/);
  assert.match(html, /ООО Поставщик/);
  assert.match(html, /ООО Клиент/);
  assert.match(html, /tracking\?trackingNumber=11111111111/);
  assert.match(html, /Накладная поставщика/);
  assert.doesNotMatch(html, /Entity is forbidden/);
});

test('ручное добавление передаёт выбранное направление', () => {
  const submit = section(
    'async function cdekSubmit()',
    'async function cdekChangeDirection('
  );

  assert.match(submit, /direction:\s*direction/);
  assert.match(submit, /\/api\/logistics\/cdek/);
  assert.match(submit, /\\d\{10,20\}/);
});

test('направление существующего трека меняется через PATCH', () => {
  const change = section(
    'async function cdekChangeDirection(',
    'async function cdekRefresh()'
  );

  assert.match(change, /apiPatch\('\/api\/logistics\/cdek\/'\s*\+\s*id/);
  assert.match(change, /\{\s*direction:\s*next\s*\}/);
});
