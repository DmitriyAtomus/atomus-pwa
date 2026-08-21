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

function helpers() {
  const context = {Set, Number, Math, Array, Object, String};
  vm.runInNewContext(
    section(
      'function _shopMfgMatches(group)',
      '// Применяет скрытие/переопределения',
    ) + '\nthis.matches = _shopMfgMatches; this.count = _shopDisplayedItemsCount; this.project = _shopProjectGroupKey;',
    context,
  );
  return context;
}

test('шесть деталей УДФ-1 отображаются одним комплектом', () => {
  const h = helpers();
  const parts = [
    [335, 2, 4], [336, 1, 2], [334, 1, 2],
    [333, 2, 4], [332, 1, 2], [337, 1, 2],
  ].map(([component_id, part_qty, qty], index) => ({
    part_id: 210 + index, component_id, part_qty, qty,
  }));
  const group = {
    supplier_id: null,
    items: parts.map(p => ({component_id: p.component_id})).concat([
      {component_id: 699}, {component_id: 980},
    ]),
    mfg_matches: [{
      item_id: 40,
      item_name: 'КОРПУС_УДФ-1',
      item_designation: 'AG-38.000.000СБ',
      parts,
    }],
  };

  const match = h.matches(group)[0];
  assert.equal(match.matched_count, 6);
  assert.equal(match.bundle_qty, 2);
  assert.equal(match.pieces_count, 16);
  assert.equal(h.count(group), 3, 'комплект + компрессор + термостат');
});

test('переход открывает комплект корпуса с уже выбранными деталями', () => {
  const render = section('function renderSupplyShopping(d)', '/* ============ ЭТАП 52');
  assert.match(render, /class="nsg-mfg-bundle"/);
  assert.match(render, /Открыть комплект/);
  assert.match(render, /openMfgFromProduction\(/);
  assert.equal(helpers().project(['Договор № 17АГ/08.26']), '17АГ/08.26');
});
