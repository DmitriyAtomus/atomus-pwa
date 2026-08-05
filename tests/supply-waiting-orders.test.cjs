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

const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString().slice(0, 19).replace('T', ' ');

function ctx() {
  const context = {
    escapeHtml: (v) => String(v == null ? '' : v),
    _plural: (n, f) => f[n === 1 ? 0 : 1],
    _fmtQty: (v) => String(v),
    _fmtMoney: (v) => String(v),
    _fmtDateRu: (v) => String(v),
    _daysSince(dateStr) {
      if (!dateStr) return null;
      const t = Date.parse(String(dateStr).replace(' ', 'T') + 'Z');
      return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / DAY);
    },
    _supDeliveryStepperHtml: () => '<div class="sup-steps"></div>',
    _CP_ORDER_STATUS_RU: { awaiting_invoice: ['Счёт запрошен'], paid: ['Оплачен'] },
    window: {},
    document: { getElementById: () => null },
  };
  context.window = context;
  const code = section('// ============ v2.45.885: ЗАКАЗЫ, КОТОРЫЕ ЖДЁМ',
                       '// v2.45.427: «Ждём поставку» — трекинг');
  vm.runInNewContext(
    `${code}\nthis.split = _supOrdersWaiting; this.card = _supOrderCardHtml; this.block = _supOrdersBlockHtml;`,
    context
  );
  return context;
}

const ORD250 = {
  id: 250, order_label: 'ORD-250', status: 'awaiting_invoice',
  status_label: 'Ожидаем счёт', supplier_name: 'ООО «РУСРЕСУРС ТРЕЙДИНГ»',
  sent_at: ago(0), items_count: 7,
};

test('отправленный запрос счёта попадает в ожидание', () => {
  const c = ctx();

  const { fresh, stale } = c.split([ORD250], []);

  assert.deepEqual(JSON.parse(JSON.stringify(fresh.map(o => o.order_label))), ['ORD-250']);
  assert.equal(stale.length, 0);
});

test('заказ, уже показанный позициями, второй раз не рисуется', () => {
  const c = ctx();

  const { fresh } = c.split([ORD250], [{ order_id: 250, name: 'Решётка' }]);

  assert.equal(fresh.length, 0);
});

test('черновики, полученные и отменённые в ожидание не попадают', () => {
  const c = ctx();
  const orders = ['draft', 'received', 'cancelled'].map((status, i) =>
    ({ id: 10 + i, status, supplier_name: 'П', created_at: ago(1) }));

  const { fresh, stale } = c.split(orders, []);

  assert.equal(fresh.length + stale.length, 0);
});

test('давно оплаченные уезжают в свёрнутый хвост, свежие остаются', () => {
  const c = ctx();
  const orders = [
    { id: 1, order_label: 'ORD-1', status: 'paid', paid_at: ago(3), supplier_name: 'А' },
    { id: 2, order_label: 'ORD-2', status: 'paid', paid_at: ago(40), supplier_name: 'Б' },
  ];

  const { fresh, stale } = c.split(orders, []);

  assert.deepEqual(JSON.parse(JSON.stringify(fresh.map(o => o.order_label))), ['ORD-1']);
  assert.deepEqual(JSON.parse(JSON.stringify(stale.map(o => o.order_label))), ['ORD-2']);
});

test('свежие идут сверху — самый новый первым', () => {
  const c = ctx();
  const orders = [
    { id: 1, order_label: 'ORD-старый', status: 'to_pay', to_pay_at: ago(9), supplier_name: 'А' },
    { id: 2, order_label: 'ORD-новый', status: 'to_pay', to_pay_at: ago(1), supplier_name: 'Б' },
  ];

  const { fresh } = c.split(orders, []);

  assert.deepEqual(JSON.parse(JSON.stringify(fresh.map(o => o.order_label))),
    ['ORD-новый', 'ORD-старый']);
});

test('карточка показывает номер, поставщика, статус и состав', () => {
  const c = ctx();
  const [o] = c.split([ORD250], []).fresh;

  const html = c.card(o);

  assert.match(html, /ORD-250/);
  assert.match(html, /РУСРЕСУРС/);
  assert.match(html, /Ожидаем счёт/);
  assert.match(html, /7 позиция|7 позиции/);
  assert.match(html, /openSupplyOrder\(250\)/);
  assert.match(html, /supOrderToggleItems\(250\)/);
});

test('заказ, который ждём дольше двух недель, помечен как просроченный', () => {
  const c = ctx();
  const [o] = c.split([{ id: 9, order_label: 'ORD-9', status: 'paid', paid_at: ago(15),
                         supplier_name: 'В', items_count: 1 }], []).fresh;

  assert.match(c.card(o), /class="sup-ord late"/);
});

test('счётчики и вкладка учитывают заказы, а не только позиции', () => {
  const render = section('const _ordWait = _supOrdersWaiting', 'const kpiStrip');
  assert.match(render, /waitingItems\.length \+ _ordWait\.fresh\.length/);
  assert.match(render, /_ordWait\.fresh\.filter\(o => o\._days !== null && o\._days >= 14\)/);
  assert.match(render, /_ordWait\.fresh\.filter\(o => o\.expected_date/);

  const pane = section('function _supRenderWaitPane()', 'function _supDeliveryStepperHtml');
  assert.match(pane, /_supOrdersBlockHtml\(orders, filter === 'all' \? stale : \[\]\)/);

  assert.match(css, /\.sup-ord\{/);
});

test('за заказами ходим одним запросом только по нужным статусам', () => {
  const loader = section('async function loadSupplyShopping()',
                         '// v2.45.233/235: блок «Покупные позиции по договорам»');
  assert.match(loader, /\/api\/supply-orders\?limit=400&status=' \+\s*SUP_WAITING_STATUSES\.join\(','\)/);
});
