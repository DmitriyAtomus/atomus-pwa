const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const sc = require('../supply-chain.js');

test('v2.46.283: без назначения заказ не отправится', () => {
  const list = [
    { id: 1, name: 'Насос', dest_type: 'contract', dest_contract_id: 7 },
    { id: 2, name: 'Фланец', dest_type: null },
    { id: 3, name: 'Болт', dest_type: 'contract', dest_contract_id: null },
    { id: 4, name: 'Краска', dest_type: 'stock' },
  ];
  assert.equal(sc.scItemDestOk(list[0]), true);
  assert.equal(sc.scItemDestOk(list[1]), false);
  assert.equal(sc.scItemDestOk(list[2]), false, 'договор без номера — не назначено');
  assert.equal(sc.scItemDestOk(list[3]), true);
  assert.equal(sc.scMissingDest(list), 2);
});

test('v2.46.283: массовое назначение — выбранные и все', () => {
  const list = [{ id: 1 }, { id: 2 }, { id: 3 }];
  sc.scApplyBulk(list, ['2', 3], 'contract', 15, '24-113');
  assert.equal(list[0].dest_type, undefined);
  assert.equal(list[1].dest_type, 'contract');
  assert.equal(list[1].dest_contract_id, 15);
  assert.equal(list[2].dest_contract_number, '24-113');
  sc.scApplyBulk(list, null, 'stock');
  assert.ok(list.every(x => x.dest_type === 'stock' && !x.dest_contract_id));
  assert.equal(sc.scMissingDest(list), 0);
});

test('v2.46.283: чип назначения — договор синим, пусто красным', () => {
  assert.match(sc.scDestChipHtml('contract', '24-113'), /sc-chip-contract[^>]*>.*№24-113/);
  assert.match(sc.scDestChipHtml('stock'), /Склад/);
  assert.match(sc.scDestChipHtml(null), /sc-chip-bad/);
  assert.match(sc.scDestChipHtml(null, '', 'go()'), /onclick="go\(\)"/);
});

test('v2.46.283: шаги цепочки — 7 шагов, запрос счёта подсвечен', () => {
  const h = sc.scStepperHtml(null, 'invoice_requested');
  assert.equal((h.match(/class="sc-step /g) || []).length, 7);
  assert.match(h, /sc-step now warn/);
  const paid = sc.scStepperHtml(null, 'paid');
  assert.equal((paid.match(/sc-step done/g) || []).length, 3);
  assert.match(paid, /now paid/);
});

test('v2.46.283: «Ждём поставку» — группы по договору и по поставщику', () => {
  const items = [
    { order_item_id: 1, dest_type: 'contract', dest_contract_id: 5, dest_contract_number: '24-1', supplier_name: 'А' },
    { order_item_id: 2, dest_type: 'contract', dest_contract_id: 5, dest_contract_number: '24-1', supplier_name: 'Б' },
    { order_item_id: 3, dest_type: 'stock', supplier_name: 'А' },
    { order_item_id: 4, dest_type: null, supplier_name: 'Б' },
  ];
  const byC = sc.scGroupWaiting(items, 'contract');
  const total = byC.reduce((n, g) => n + g.items.length, 0);
  assert.equal(total, 4, 'строки не схлопываются');
  assert.ok(byC.some(g => /24-1/.test(g.title) && g.items.length === 2));
  const byS = sc.scGroupWaiting(items, 'supplier');
  assert.deepEqual(byS.map(g => g.items.length).sort(), [2, 2]);
});

test('v2.46.283: файл подключён, версия поднята везде', () => {
  // v2.46.284: номер версии больше не прибит к 283 — проверяем, что все 4 места совпадают
  assert.match(read('index.html'), /<script src="\/app-4\.js"><\/script>\n<script src="\/supply-chain\.js"><\/script>/);
  assert.match(read('sw.js'), /'\/supply-chain\.js'/);
  const v = JSON.parse(read('version.json')).version;
  assert.ok(v >= 'v2.46.283', v);
  assert.ok(read('sw.js').includes("atomus-" + v + "'"));
  assert.ok(read('app-1.js').includes('APP_VERSION = "' + v + '"'));
  assert.ok(read('app-3.js').includes("HELP_CHANGELOG = [\n  {version:'" + v + "'"));
  assert.match(read('app-3.js'), /\{version:'v2\.46\.283'/);
});

test('v2.46.283: поиск счетов — 250 мс, новые фильтры уходят в /api/pay-list', () => {
  const src = read('supply-chain.js');
  assert.match(src, /setTimeout\(root\.loadPayList, 250\)/);
  for (const k of ['contract_id', 'date_from', 'date_to', 'amount_from', 'amount_to', 'payer', 'no_supplier', 'zero_amount', 'duplicates']) {
    assert.ok(src.includes("'" + k + "'"), k);
  }
  assert.match(read('index.html'), /id="sc-pay-issues"/);
});

test('v2.46.283: отмена — только с причиной через /cancel', () => {
  const src = read('supply-chain.js');
  assert.match(src, /newStatus !== 'cancelled'/);
  assert.match(src, /\/cancel', \{ reason \}/);
});

test('legacy orders (chain_new=false): missing dest not flagged red', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'supply-chain.js'), 'utf8');
  assert.match(src, /o\.chain_new === false/);
  assert.match(src, /необязательно/);
});

test('invoice lines: suggestion only, new items need explicit tick', () => {
  const sc = require('../supply-chain.js');
  const h = sc.scInvLinesHtml(5, [
    { idx: 0, name: 'Вентилятор', qty: 2, unit: 'шт', match_item_id: 9, match_name: 'Вентилятор ВО-1' },
    { idx: 1, name: 'Решётка', qty: 1, unit: 'шт', match_item_id: null },
    { idx: 2, name: 'Уже', qty: 1, added: true },
  ]);
  assert.match(h, /data-item="9"><input type="checkbox" checked>/);
  assert.match(h, /data-idx="1"><input type="checkbox">/);
  assert.match(h, /новая — завести в номенклатуру/);
  assert.doesNotMatch(h, /Уже/);
  assert.equal(sc.scInvLinesHtml(5, [{ idx: 0, name: 'x', added: true }]), '');
});
