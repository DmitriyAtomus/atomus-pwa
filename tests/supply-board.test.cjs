/**
 * Доска «Заказано у поставщиков» на Главной.
 *
 * Плитка — поставщик, карточка внутри — оплаченный заказ. Проверяем разметку:
 * счётчики и чипы сверху, плитка поставщика без заказов не исчезает, карточка
 * раскрывается позициями, а суммы и статусы на доску не попадают.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app2 = fs.readFileSync(path.join(__dirname, '..', 'app-2.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');

function board(data, filter) {
  const src = app2.slice(app2.indexOf('const SBRD_COLORS = ['));
  const ctx = {
    escapeHtml: (s) => String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    state: { supBoardFilter: filter || 'all' },
    cache: { supplyBoard: data },
    hasPermission: () => true,
    document: {
      _els: {},
      getElementById(id) {
        if (!this._els[id]) this._els[id] = { id, style: {}, innerHTML: '' };
        return this._els[id];
      },
    },
  };
  vm.runInNewContext(src + '\nthis.render = renderHomeSupplyBoard;', ctx);
  ctx.render();
  return {
    html: ctx.document.getElementById('home-supboard-block').innerHTML,
    wrap: ctx.document.getElementById('home-supboard-wrap'),
  };
}

const TILE = {
  supplier_key: 'электрокомплект',
  supplier_id: 7,
  supplier_name: 'ООО «Электрокомплект-Урал»',
  abbr: 'ЭУ',
  orders_count: 2,
  trip_count: 1,
  done_count: 4,
  earliest_date: '2026-09-02',
  orders: [
    {
      order_id: 11, order_label: 'ORD-11', order_date: '2026-09-02',
      items_count: 2, self_pickup: true, in_trip: false,
      order_items: [
        { name: 'Кабель ВВГ 3х2,5', qty: 50, unit: 'м' },
        { name: 'Автомат C16', qty: 8, unit: 'шт.' },
      ],
    },
    {
      order_id: 12, order_label: 'ORD-12', order_date: '2026-09-15',
      items_count: 1, self_pickup: true, in_trip: true,
      trip_number: 'Р-005', trip_date: '2026-09-23', trip_driver: 'Подкорытова О.В.',
      order_items: [{ name: 'Щит ЩМП-2', qty: 1, unit: 'шт.' }],
    },
  ],
};
const EMPTY_TILE = {
  supplier_key: 'метизныйдвор', supplier_id: 9, supplier_name: 'Метизный двор',
  abbr: 'МД', orders_count: 0, trip_count: 0, done_count: 3,
  earliest_date: null, orders: [],
};
const DATA = {
  suppliers: [TILE, EMPTY_TILE],
  counts: { suppliers: 1, orders: 2, in_trip: 1, earliest_date: '2026-09-02' },
};

test('сверху — счётчики: поставщики, заказы, ждут рейс, самый ранний заказ', () => {
  const { html } = board(DATA);
  assert.match(html, /<b>1<\/b><span>поставщик<\/span>/);
  assert.match(html, /<b>2<\/b><span>оплаченных заказа<\/span>/);
  assert.match(html, /<b>1<\/b><span>ждут рейс<\/span>/);
  assert.match(html, /<b>02\.09<\/b><span>самый ранний заказ<\/span>/);
});

test('чипы фильтров со своими счётчиками, по умолчанию «Все поставщики»', () => {
  const { html } = board(DATA);
  assert.match(html, /sbrd-chip on" onclick="setSupplyBoardFilter\('all'\)">Все поставщики<span>2<\/span>/);
  assert.match(html, /setSupplyBoardFilter\('self'\)">Забираем сами<span>1<\/span>/);
  assert.match(html, /setSupplyBoardFilter\('trip'\)">Ждём рейс логистики<span>1<\/span>/);
});

test('карточки заказов идут в порядке, что дал бэкенд: ранний выше', () => {
  const { html } = board(DATA);
  assert.ok(html.indexOf('ORD-11') < html.indexOf('ORD-12'));
  assert.match(html, /Дата заказа: 02\.09\.2026 · 2 позиции/);
  assert.match(html, /Дата заказа: 15\.09\.2026 · 1 позиция/);
});

test('внутри карточки — позиции с количеством и обе ссылки', () => {
  const { html } = board(DATA);
  assert.match(html, /<span class="nm">Кабель ВВГ 3х2,5<\/span><span class="qt">50 м<\/span>/);
  assert.match(html, /openSupplyOrderFromBoard\(11\)">Открыть заказ в Снабжении →/);
  assert.match(html, /sbrdTake\(11\)"><i class="ti ti-check"><\/i> Отметить «Забрал»/);
});

test('заказ в рейсе помечен рейсом, метка оплаты есть у всех', () => {
  const { html } = board(DATA);
  assert.match(html, /Р-005 · 23\.09\.2026 · Подкорытова О\.В\./);
  assert.equal((html.match(/sbrd-paid/g) || []).length, 2);
});

test('плитка без оплаченных заказов остаётся с пустым состоянием', () => {
  const { html } = board(DATA);
  assert.match(html, /Метизный двор/);
  assert.match(html, /Оплаченных заказов нет/);
  assert.match(html, /забрано: 3 →/);
});

test('фильтр «Ждём рейс логистики» гасит карточки, но не плитки', () => {
  const { html } = board(DATA, 'trip');
  assert.match(html, /ORD-12/);
  assert.doesNotMatch(html, /ORD-11/);
  // обе плитки на месте, у обеих пустое состояние или заказ
  assert.match(html, /Электрокомплект-Урал/);
  assert.match(html, /Метизный двор/);
});

test('сумм и статусов заказа на доске нет', () => {
  const { html } = board(DATA);
  assert.doesNotMatch(html, /₽|invoice_total|total_amount/);
  assert.doesNotMatch(html, /Ждёт счёт|К оплате|Черновик/);
});

test('доска скрыта, когда поставщиков нет вовсе', () => {
  const { wrap } = board({ suppliers: [], counts: {} });
  assert.equal(wrap.style.display, 'none');
});

test('стили доски лежат в app.css', () => {
  ['.sbrd-chip', '.sbrd-ava', '.sbrd-o-bd', '.sbrd-items', '.sbrd-take'].forEach((sel) => {
    assert.ok(css.includes(sel), `нет стиля ${sel}`);
  });
  // карточка раскрывается только по классу open
  assert.match(css, /\.sbrd-o-bd \{ display: none;/);
  assert.match(css, /\.sbrd-o\.open \.sbrd-o-bd \{ display: block; \}/);
});
