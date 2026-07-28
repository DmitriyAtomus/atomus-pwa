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

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

test('логистика загружает Ozon вместе с перевозчиками', () => {
  const load = section(
    'async function loadLogisticsPickups()',
    '// ============ v2.45.828: Ozon'
  );

  assert.match(load, /apiGet\('\/api\/logistics\/ozon'\)/);
  assert.match(load, /_ozonBlockHtml\(oz\)/);
  assert.match(load, /Ozon · к нам/);
});

test('карточка Ozon показывает заказ, статус, срок и действия', () => {
  const context = { escapeHtml, Date, isNaN };
  const code = section(
    '// ============ v2.45.828: Ozon',
    '// ============ v2.45.715: СДЭК'
  );
  vm.runInNewContext(`${code}\nthis.render = _ozonBlockHtml;`, context);

  const html = context.render({
    shipments: [{
      id: 8,
      order_number: '0208297309-0043',
      shipment_id: '41792027517',
      status_code: 'ready_for_pickup',
      status_label: 'Готово к выдаче',
      notification_title: 'Заберите ваши товары',
      delivery_method: 'Пункт выдачи',
      deadline_at: '2099-07-27 21:00:00',
      details_url: 'https://www.ozon.ru/my/orderdetails/?order=0208297309-0043&shipment_id=41792027517',
    }],
  });

  assert.match(html, /Заказ 0208297309-0043/);
  assert.match(html, /Отправление 41792027517/);
  assert.match(html, /Готово к выдаче/);
  assert.match(html, /Забрать до 27\.07 · 21:00/);
  assert.match(html, /Открыть в Ozon/);
  assert.match(html, /ozonMarkDone\(8\)/);
});

test('ручное обновление перечитывает Ozon-письма', async () => {
  const requests = [];
  const toasts = [];
  let reloads = 0;
  const context = {
    escapeHtml,
    Date,
    isNaN,
    showToast(message, type) { toasts.push({ message, type }); },
    async apiPost(url, body) {
      requests.push({ url, body });
      return { ok: true, data: { found: 1 } };
    },
    loadLogisticsPickups() { reloads += 1; },
  };
  const code = section(
    '// ============ v2.45.828: Ozon',
    '// ============ v2.45.715: СДЭК'
  );
  vm.runInNewContext(`${code}\nthis.refresh = ozonRefresh;`, context);

  await context.refresh();

  assert.deepEqual(
    JSON.parse(JSON.stringify(requests)),
    [{ url: '/api/logistics/ozon/refresh', body: {} }]
  );
  assert.equal(reloads, 1);
  assert.deepEqual(toasts.at(-1), {
    message: 'Ozon обновлён: найдено писем 1',
    type: 'success',
  });
});
