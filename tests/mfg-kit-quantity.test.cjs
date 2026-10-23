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

function helpers(document, state) {
  const context = {document, state, Number, Math, Array, String};
  vm.runInNewContext(
    section('function _mfgOrderPartQty(it, part)', 'function mfgTogglePart(partId)') +
      '\nthis.kitCount = _mfgOrderKitCount; this.setKits = mfgOrderSetKits;',
    context,
  );
  return context;
}

test('суммарная потребность распознаётся как два готовых комплекта', () => {
  const state = {
    _mfgOrderPrefill: {
      itemId: 40,
      qtyByPart: {210: 4, 211: 2, 212: 2, 213: 4},
    },
  };
  const parts = [
    {id: 210, qty: 2}, {id: 211, qty: 1},
    {id: 212, qty: 1}, {id: 213, qty: 2},
  ];
  const h = helpers({}, state);
  assert.equal(h.kitCount({id: 40}, parts), 2);
});

test('выбор двух комплектов умножает нормы всех деталей', () => {
  const qtyA = {value: '2'};
  const qtyB = {value: '1'};
  const rows = [
    {dataset: {unitQty: '2'}, querySelector: () => qtyA},
    {dataset: {unitQty: '1'}, querySelector: () => qtyB},
  ];
  const boxes = {
    'mo-kit-count': {value: '1'},
    'mo-total-positions': {textContent: ''},
    'mo-total-pieces': {textContent: ''},
    'mo-subject': {value: '', dataset: {}},
  };
  const document = {
    querySelectorAll: () => rows,
    getElementById: id => boxes[id] || null,
  };
  const h = helpers(document, {mfgCurrentItem: {designation: 'AG-38.000.000СБ'}});

  h.setKits(2);

  assert.equal(qtyA.value, '4');
  assert.equal(qtyB.value, '2');
  assert.equal(boxes['mo-total-pieces'].textContent, '6');
  assert.match(boxes['mo-subject'].value, /2 поз\., 6 шт/);
});

test('в окне заказа есть общий счётчик комплектов и ручная правка строк', () => {
  const modal = section('async function mfgOrderOpen(itemId)', 'function mfgSupDD(q)');
  assert.match(modal, /Количество комплектов/);
  assert.match(modal, /id="mo-kit-count"/);
  assert.match(modal, /data-unit-qty=/);
  assert.match(modal, /oninput="mfgOrderQtyChanged\(\)"/);
});
