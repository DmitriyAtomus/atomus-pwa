// Карточка сверки приёмки с заказами (v2.45.1013).
// 20.08.2026: УПД оприходована, металл на складе, а ORD-270/273 висят «получено
// частично» — и никто об этом не узнаёт. Карточка обязана показывать спорные
// строки и давать кнопку разноса; если всё сошлось — быть зелёной и молчаливой.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');

function reconContext() {
  const code = source.slice(
    source.indexOf('// ==== СВЕРКА ПРИЁМКИ С ЗАКАЗАМИ'),
    source.indexOf('function renderSiDestTiles(items) {')
  );
  assert.ok(code.length > 100, 'секция сверки не найдена в app-4.js');
  const context = {
    escapeHtml(value) {
      return String(value == null ? '' : value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    },
    siState: {},
    document: { getElementById: () => null },
  };
  vm.runInNewContext(`${code}\nthis.render = renderSiRecon;`, context);
  return context;
}

const BAD = {
  ok: false,
  counts: { accepted_lines: 3, matched: 2, partial: 1, unmatched: 1, short: 1, orders: 1 },
  orders: [{ order_id: 270, order_label: 'ORD-270' }],
  matched: [
    {
      invoice_item_id: 1, name: 'Прижим 0,8', qty: 40, unit: 'шт', allocated: 40, remaining: 0,
      targets: [{ order_id: 270, order_label: 'ORD-270', order_item_id: 11, si_name: 'Прижим 0,8', qty: 40 }],
    },
    {
      invoice_item_id: 2, name: 'Кронштейн датчика', qty: 4, unit: 'шт', allocated: 2, remaining: 2, partial: true,
      targets: [{ order_id: 270, order_label: 'ORD-270', order_item_id: 12, si_name: 'Кронштейн датчика', qty: 2 }],
      candidates: [{ order_id: 270, order_label: 'ORD-270', order_item_id: 12, si_name: 'Кронштейн датчика', remaining: 2, likely: true }],
    },
  ],
  unmatched: [
    {
      invoice_item_id: 3, name: 'Пластина <b>опорная</b>', name_raw: 'Пластина опорная', qty: 8, unit: 'шт',
      allocated: 0, remaining: 8,
      candidates: [
        { order_id: 273, order_label: 'ORD-273', order_item_id: 31, si_name: 'Пластина опорная', remaining: 8, likely: true },
        { order_id: 270, order_label: 'ORD-270', order_item_id: 13, si_name: 'Косынка', remaining: 16, likely: false },
      ],
    },
  ],
  short: [
    { order_id: 270, order_label: 'ORD-270', order_item_id: 13, si_name: 'Косынка', qty: 16, received: 0, remaining: 16 },
  ],
};

test('спорные строки видно, у каждой — кнопка разноса и кандидаты', () => {
  const html = reconContext().render(BAD, 152);

  assert.ok(html.includes('Не разнесено по заказам · 1'));
  assert.ok(html.includes('Разнесено частично · 1'));
  assert.ok(html.includes('Заказ ждёт ещё · 1'));
  assert.ok(html.includes('Разнесено по заказам · 1'));   // полностью легла только одна
  assert.ok(!html.includes('si-recon ok'), 'карточка не должна быть зелёной');

  // кнопка «Разнести» ведёт в конкретную позицию заказа
  assert.ok(html.includes("siReconAssign(152,3,31)"));
  assert.ok(html.includes("siReconAssign(152,3,13)"));
  // похожая позиция помечена
  assert.ok(html.includes('si-recon-cand likely'));
  assert.ok(html.includes('похоже'));
  // недобор по заказу — со знаком минус
  assert.ok(html.includes('−16'));
});

test('имя из накладной экранируется', () => {
  const html = reconContext().render(BAD, 152);
  assert.ok(html.includes('Пластина &lt;b&gt;опорная&lt;/b&gt;'));
  assert.ok(!html.includes('<b>опорная</b>'));
});

test('когда всё сошлось — карточка зелёная и без кнопок разноса', () => {
  const good = {
    ok: true,
    counts: { accepted_lines: 1, matched: 1, partial: 0, unmatched: 0, short: 0, orders: 1 },
    orders: [{ order_id: 270, order_label: 'ORD-270' }],
    matched: [BAD.matched[0]],
    unmatched: [],
    short: [],
  };
  const html = reconContext().render(good, 152);
  assert.ok(html.includes('si-recon ok'));
  assert.ok(html.includes('Всё сошлось'));
  assert.ok(!html.includes('siReconAssign('));
});

test('без отчёта карточка не рисуется', () => {
  const ctx = reconContext();
  assert.equal(ctx.render(null, 152), '');
  assert.equal(ctx.render({}, 152), '');
});
