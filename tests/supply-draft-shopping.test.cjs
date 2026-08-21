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

function shoppingFilter() {
  const context = {
    _shopGetHidden: () => new Set(),
    _shopGetQtyMap: () => ({}),
  };
  vm.runInNewContext(
    section(
      'function _shopIsWaitingStatus(status)',
      '// v2.45.x: редизайн «Что закупить»',
    ) + '\nthis.apply = _shopApplyLocal; this.waiting = _shopIsWaitingStatus;',
    context,
  );
  return context;
}

test('неотправленный черновик остаётся в списке к закупке', () => {
  const filter = shoppingFilter();
  const draft = {component_id: 1, order_status: 'draft', recommended_qty: 1};
  const sent = {component_id: 2, order_status: 'sent', recommended_qty: 1};

  assert.equal(filter.waiting('draft'), false);
  assert.equal(filter.waiting('sent'), true);
  assert.deepEqual(
    Array.from(filter.apply([draft, sent]).items, row => row.component_id),
    [1],
  );
});

test('повторное формирование продолжает существующий ORD, а не создаёт дубль', () => {
  const preview = section(
    'async function openExistingShoppingDraft(orderId)',
    '// v2.45.337: «Оформить вручную»',
  );
  assert.match(preview, /it\.order_status === 'draft' && it\.order_id/);
  assert.match(preview, /openExistingShoppingDraft\(Math\.max\.apply\(null, draftIds\)\)/);
  assert.match(source, /Продолжить ' \+ escapeHtml\(draftOrderLabel/);
});
