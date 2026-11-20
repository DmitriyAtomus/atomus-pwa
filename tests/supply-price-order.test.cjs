const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');

test('прайсы одного поставщика пополняют один черновик и сохраняют назначение', () => {
  const open = source.indexOf('function _owzOpenSupplierPrices()');
  const next = source.indexOf('function _owzSupChange()', open);
  assert.ok(open >= 0 && next > open);
  const state = { supplierId: 7, supplierName: 'БИС', list: [], custom: 0, dest: 'stock' };
  let pick, saved = 0;
  const ctx = {
    _owz: state, _owzRenderCart: () => {}, _owzSaveDraft: () => { saved++; },
    openSupplyPriceCatalog: (id, name, onPick, getCart) => {
      assert.equal(id, 7);
      assert.equal(name, 'БИС');
      assert.equal(getCart(), state.list);
      pick = onPick;
    },
  };
  vm.runInNewContext(source.slice(open, next) + '\n_owzOpenSupplierPrices();', ctx);
  assert.equal(pick({ name: 'EH-1700', code: 'НС-1272628', price: null }), 1);
  assert.equal(pick({ name: 'XGI-JP21RHA-ODU', code: 'НС-1689593', price: 12800 }), 1);
  assert.equal(pick({ name: 'XGI-JP21RHA-ODU', code: 'НС-1689593', price: 12800 }), 2);
  assert.deepEqual(state.list.map(x => [x.name, x.qty, x.dest_type, x.supplierPrice.price]), [
    ['EH-1700 (НС-1272628)', 1, 'stock', null],
    ['XGI-JP21RHA-ODU (НС-1689593)', 2, 'stock', 12800],
  ]);
  state.supplierId = 8;
  assert.equal(pick({ name: 'EH-1700', code: 'НС-1272628', price: null }), 0);
  assert.equal(saved, 3);
});
