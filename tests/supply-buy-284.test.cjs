const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const sb = require('../supply-buy.js');

const NOW = Date.UTC(2026, 10, 3, 12, 0);
function fixture() {
  const utmLines = ['AG-25.000.001 Балка монтажная', 'AG-25.000.002 Балка продольная', 'AG-25.010.001 Крышка верхняя'];
  const waiting = { items: [], no_items: [] };
  utmLines.forEach((n, i) => {
    waiting.items.push({ order_id: 458, order_label: 'ORD-458', name: n, qty: 4, remaining: 4, unit: 'шт.', dest_type: 'contract', dest: { type: 'contract', label: '№24ТД/10.26' }, dest_contract_number: '№ 24ТД/10.26', dest_contractor_name: 'ООО Молочный двор', dest_contract_id: 17 });
    waiting.items.push({ order_id: 459, order_label: 'ORD-459', name: n, qty: 4, remaining: 4, unit: 'шт.', dest_type: null, dest: { type: null, label: 'Не выбрано' } });
  });
  waiting.items.push({ order_id: 464, order_label: 'ORD-464', name: 'ТЭНР 119.5', qty: 30, remaining: 30, unit: 'шт.', dest_type: 'shop', dest: { type: 'shop', label: 'Цех' } });
  const orders = [
    { id: 458, order_label: 'ORD-458', status: 'invoice_requested', supplier_id: 10, supplier_name: 'УТМ', created_at: '2026-11-02 08:16:56', step: { days: 1 } },
    { id: 459, order_label: 'ORD-459', status: 'invoice_requested', supplier_id: 10, supplier_name: 'УТМ', created_at: '2026-11-02 08:16:56', step: { days: 1 } },
    { id: 464, order_label: 'ORD-464', status: 'invoice_requested', supplier_id: 7, supplier_name: 'ООО ТПК Миасс ТЭН', created_at: '2026-11-02 11:25:06', step: { days: 1 } },
    { id: 462, order_label: 'ORD-462', status: 'paid', supplier_id: 10, supplier_name: 'УТМ', created_at: '2026-11-02 11:05:30', invoice_total: 138717.24, comment: 'Счёт УТМ (корпуса) — авто из почты', paid_at: '2026-11-02 11:12:05', step: { days: 1 }, invoice_items: [{ name: 'Балка нижняя', qty: 2, unit: 'шт' }, { name: 'Балка верхняя', qty: 2, unit: 'шт' }] },
    { id: 455, order_label: 'ORD-455', status: 'paid', supplier_id: 99, supplier_name: 'Поставщик', created_at: '2026-10-27 07:21:30', invoice_total: 4745, dest_type: 'shop', paid_at: '2026-10-27 09:05:03', step: { days: 7 }, invoice_items: [{ name: 'Sebmet Тележка ГБ-1', qty: 1, unit: 'шт' }] },
    { id: 470, order_label: 'ORD-470', status: 'to_pay', supplier_id: 5, supplier_name: 'Крафт', created_at: '2026-11-03 06:00:00', invoice_total: 1000, dest_type: 'stock', step: { days: 0 } },
    { id: 300, order_label: 'ORD-300', status: 'closed', supplier_id: 5, supplier_name: 'Крафт' },
  ];
  const closed = [{ id: 454, order_label: 'ORD-454', status: 'closed', closed_at: '2026-11-03 10:10:12', comment: '[архив: старше недели]', invoice_items: [{ name: 'Sebmet Тележка ГБ-1' }] }];
  const shop = { groups: [
    { supplier_id: 9, supplier_name: 'ИП Кирьякова', items: [{ component_id: 135, component_name: 'Термостат защитный', unit: 'шт.', effective_stock: 13, min_stock: 15, recommended_qty: 15, plan_contracts: [] }] },
    { supplier_id: 10, supplier_name: 'УТМ', items: [{ component_id: 251, component_name: 'Кронштейн', purchase_status: 'ordered', order_status: 'invoice_requested', recommended_qty: 4 }] },
    { supplier_id: null, supplier_name: '(поставщик не назначен)', items: [{ component_id: 319, component_name: 'AG-02.001.001 Крышка', unit: 'шт', recommended_qty: 2, reason: 'очередь на склад', is_critical: true, plan_contracts: [] }] },
  ] };
  const cp = [{ id: 151, contract_id: 17, qty: 2, unit: 'шт.', purchase_status: 'pending', item_name: 'НВП-15-380-AISI', contract_number: '№ 24ТД/10.26', contractor_name: 'ООО Молочный двор', supplier_id: null }];
  return { shop, cp, waiting, orders, closed, now: NOW };
}

test('v2.46.284: этапы — купить / ждём счёт / на оплату / едет', () => {
  const rows = sb.sbBuildRows(fixture());
  const by = k => rows.find(r => r.key === k);
  assert.equal(by('o458').stage, 'inv');
  assert.equal(by('o470').stage, 'pay');
  assert.equal(by('o462').stage, 'go');
  assert.equal(by('c135:9').stage, 'buy');
  assert.equal(by('p151').stage, 'buy');
  assert.ok(!rows.some(r => r.key === 'o300'), 'закрытые не показываем');
  assert.ok(!rows.some(r => r.component_id === 251), 'уже заказанное не предлагаем купить');
});

test('v2.46.284: «Куда» — договор по строкам, склад, цех, без «Куда»', () => {
  const rows = sb.sbBuildRows(fixture());
  const by = k => rows.find(r => r.key === k);
  assert.equal(by('o458').dk, 'c:24ТД/10.26');
  assert.equal(by('p151').dk, 'c:24ТД/10.26', 'договор из покупной позиции совпадает с договором заказа');
  assert.equal(by('o464').dk, 'shop');
  assert.equal(by('c135:9').dk, 'stock');
  assert.equal(by('o462').dk, 'none');
  assert.ok(by('o462').problems.includes('nodest'));
  assert.equal(by('o462').action.label, 'Назначить «Куда»');
  assert.equal(by('o462').action.js, 'sbDestPick(462)', 'v2.46.285: сразу окно выбора, не карточка');
  const groups = sb.sbGroups(rows, 'dest');
  assert.deepEqual(groups.map(g => g.kind), ['contract', 'stock', 'shop', 'none']);
});

test('v2.46.284: дубль — тот же поставщик и позиции в ту же минуту, стоит под оригиналом', () => {
  const rows = sb.sbBuildRows(fixture());
  const dup = rows.find(r => r.key === 'o459');
  assert.equal(dup.dupOf.label, 'ORD-458');
  assert.ok(dup.problems.includes('dup'));
  assert.equal(dup.dk, 'c:24ТД/10.26', 'дубль показываем в группе оригинала');
  assert.equal(dup.action.label, 'Отменить дубль');
  assert.match(dup.action.js, /^openSupplyOrder\(459\)$/);
  const g = sb.sbGroups(rows, 'dest').find(x => x.kind === 'contract');
  const keys = g.rows.map(r => r.key);
  assert.equal(keys.indexOf('o459'), keys.indexOf('o458') + 1);
});

test('v2.46.284: оплачено, а пара закрыта архивом — «Дубль · не пришло?», 7 дней красным', () => {
  const r = sb.sbBuildRows(fixture()).find(x => x.key === 'o455');
  assert.equal(r.dupLabel, 'Дубль · не пришло?');
  assert.match(r.sub, /пара ORD-454 закрыта архивом/);
  assert.deepEqual(r.age, { text: '7 дн', cls: 'lr' });
  assert.equal(r.action.label, 'Пришла / не пришла');
});

test('v2.46.284: плитки-счётчики и «Требуют решения»', () => {
  const t = sb.sbTiles(sb.sbBuildRows(fixture()));
  assert.equal(t.buy.n, 3);
  assert.equal(t.buy.critical, 1);
  assert.equal(t.inv.n, 2, 'дубль не считается вторым заказом');
  assert.equal(t.inv.lines, 4);
  assert.equal(t.pay.n, 1);
  assert.equal(t.go.n, 2);
  assert.equal(t.go.nodate, 2);
  assert.equal(t.problem.by.dup, 2);
  assert.equal(t.problem.by.nosup, 2);
  assert.equal(t.problem.by.nodest, 1);
  const h = sb.sbTilesHtml(t, 'inv');
  assert.equal((h.match(/class="sbv-tile /g) || []).length, 5);
  assert.match(h, /sbv-tile inv on/);
  for (const w of ['Купить', 'Ждём счёт', 'На оплату', 'Оплачено, едет', 'Требуют решения']) assert.ok(h.includes(w), w);
});

test('v2.46.284: одна кнопка следующего шага, кнопки ничего не отправляют сами', () => {
  const rows = sb.sbBuildRows(fixture());
  const by = k => rows.find(r => r.key === k);
  assert.equal(by('c135:9').action.js, 'openCreateOrderPreview(9)');
  assert.equal(by('c319:0').action.label, 'Выбрать поставщика');
  assert.equal(by('p151').action.js, 'sbCpPick(151)');
  assert.equal(by('o458').action.js, 'sbRemind(458)');
  assert.equal(by('o470').action.label, 'Оплатить');
  rows.forEach(r => {
    const h = sb.rowHtml(r, false);
    assert.equal((h.match(/class="sbv-btn/g) || []).length, 1, r.key);
    assert.doesNotMatch(r.action.js, /apiPost|fetch|transition/);
  });
});

test('v2.46.284: поиск и фильтры', () => {
  const rows = sb.sbBuildRows(fixture());
  assert.deepEqual(sb.sbFilter(rows, { q: 'балка продольная' }).map(r => r.key).sort(), ['o458', 'o459']);
  assert.deepEqual(sb.sbFilter(rows, { q: '138 717' }).map(r => r.key), ['o462']);
  assert.ok(sb.sbFilter(rows, { dest: 'stock' }).every(r => r.dk === 'stock'));
  assert.ok(sb.sbFilter(rows, { tile: 'problem' }).every(r => r.problems.length));
  assert.ok(sb.sbFilter(rows, { problems: true }).length > 0);
  const chips = sb.sbChips(rows).map(c => c.label);
  assert.deepEqual(chips, ['№24ТД/10.26', 'Склад', 'Цех', 'Без «Куда»']);
});

test('v2.46.284: заказ раскрывается списком позиций', () => {
  const r = sb.sbBuildRows(fixture()).find(x => x.key === 'o458');
  assert.doesNotMatch(sb.rowHtml(r, false), /sbv-mini/);
  const h = sb.rowHtml(r, true);
  assert.equal((h.match(/<div><span title=/g) || []).length, 3);
  assert.match(h, /Балка монтажная/);
});

test('v2.46.284: подключено в index.html и sw.js, версия поднята везде', () => {
  const idx = read('index.html');
  assert.ok(idx.indexOf('/supply-buy.js') > idx.indexOf('/supply-chain.js'), 'после supply-chain.js');
  assert.match(idx, /href="\/supply-buy.css"/);
  assert.match(read('sw.js'), /'\/supply-buy.js'/);
  // v2.46.285: номер не прибит к 284 — все 4 места совпадают, запись 284 в журнале осталась
  const v = JSON.parse(read('version.json')).version;
  assert.ok(v >= 'v2.46.284', v);
  assert.ok(read('sw.js').includes('atomus-' + v + "'"));
  assert.ok(read('app-1.js').includes('APP_VERSION = "' + v + '"'));
  assert.ok(read('app-3.js').includes("{version:'" + v + "'"));
  assert.match(read('app-3.js'), /\{version:'v2\.46\.284'/);
});

test('v2.46.284: ссылка «Старый вид экрана» не под плавающей кнопкой «Показать Клаве»', () => {
  const css = read('supply-buy.css');
  assert.match(css, /\.sbv-foot\{[^}]*text-align:left/);
  assert.match(css, /\.sbv-foot\{[^}]*padding-bottom:72px/);
});
