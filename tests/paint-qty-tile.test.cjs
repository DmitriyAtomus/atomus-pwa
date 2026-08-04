const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

const ITEM = {
  id: 42,
  calc_id: 7,
  designation: 'AG-24.000.002',
  name: 'Балка монтажная 1000',
  qty: 1,
  thickness_mm: 2,
  material: 'Углеродистая сталь',
  paint_total_m2: 0.17,
};

function tileHtml(it) {
  const context = {
    escapeHtml: (v) => String(v || ''),
    _paintMatName: (x) => x.material || '',
    _paintManualTag: () => '',
    _paintStatusChip: () => '',
  };
  const code = section('function _paintTileHtml(it, isSel)', '// ============ v2.45.878');
  vm.runInNewContext(`${code}\nthis.tile = _paintTileHtml;`, context);
  return context.tile(it, false);
}

test('плитка даёт поставить количество, не открывая таблицу', () => {
  const html = tileHtml(ITEM);

  assert.match(html, /paintQtyStep\(7,42,-1\)/);
  assert.match(html, /paintQtyStep\(7,42,1\)/);
  assert.match(html, /id="pdx-qty-42"/);
  assert.match(html, /value="1"/);
  assert.match(html, /onblur="paintQtyFlush\(7,42\)"/);
});

// Клик по плитке выбирает деталь в партию — счётчик не должен этого делать.
test('нажатия на счётчик не переключают выбор детали', () => {
  const html = tileHtml(ITEM);
  const badge = html.slice(html.indexOf('pdx-qty'), html.indexOf('pdx-info'));

  assert.match(badge, /onclick="event\.stopPropagation\(\)"/);
  assert.equal((badge.match(/event\.stopPropagation\(\)/g) || []).length >= 4, true);
});

function qtyContext(item, onPatch) {
  const input = { value: String(item.qty), select() {}, focus() {} };
  const host = { querySelector: () => input };
  const saved = [];
  const context = {
    document: {
      getElementById: (id) => (id === 'pdx-qty-' + item.id ? host : null),
      activeElement: null,
    },
    state: { currentPaintCalc: { id: item.calc_id, items: [item] } },
    setTimeout: (fn) => { context._timer = fn; return 1; },
    clearTimeout: () => { context._timer = null; },
    async savePaintItem(calcId, itemId, patch) { saved.push({ calcId, itemId, patch }); },
    showToast() {},
  };
  const code = section('// ============ v2.45.878', 'function paintZoom(itemId)');
  vm.runInNewContext(
    `${code}\nthis.step = paintQtyStep; this.flush = paintQtyFlush; this.typed = paintQtyTyped;`,
    context
  );
  context._input = input;
  context._saved = saved;
  if (onPatch) onPatch(context);
  return context;
}

test('плюс копит клики и отправляет одно сохранение', async () => {
  const ctx = qtyContext({ ...ITEM });

  ctx.step(7, 42, 1);
  ctx.step(7, 42, 1);
  ctx.step(7, 42, 1);

  assert.equal(ctx._input.value, 4);
  assert.equal(ctx._saved.length, 0, 'до истечения паузы ничего не шлём');
  await ctx._timer();
  assert.deepEqual(JSON.parse(JSON.stringify(ctx._saved)),
    [{ calcId: 7, itemId: 42, patch: { qty: 4 } }]);
});

test('количество не опускается ниже одной штуки', async () => {
  const ctx = qtyContext({ ...ITEM });

  ctx.step(7, 42, -1);

  assert.equal(ctx._input.value, 1);
  await ctx._timer();
  assert.equal(ctx._saved.length, 0, 'значение не изменилось — запрос не нужен');
});

test('введённое число сохраняется при уходе из поля', () => {
  const ctx = qtyContext({ ...ITEM });

  ctx._input.value = '12';
  ctx.flush(7, 42);

  assert.deepEqual(JSON.parse(JSON.stringify(ctx._saved)),
    [{ calcId: 7, itemId: 42, patch: { qty: 12 } }]);
});

test('пустое поле возвращает прежнее количество, а не ноль', () => {
  const ctx = qtyContext({ ...ITEM, qty: 5 });

  ctx._input.value = '';
  ctx.flush(7, 42);

  assert.equal(ctx._input.value, 5);
  assert.equal(ctx._saved.length, 0);
});

test('в поле остаются только цифры', () => {
  const ctx = qtyContext({ ...ITEM });

  ctx.typed(7, 42, '3ш');

  assert.equal(ctx._input.value, '3');
});
