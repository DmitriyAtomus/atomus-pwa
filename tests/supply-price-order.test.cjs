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

test('каталог подставляет модель и код только в выбранную строку после успешной проверки', async () => {
  const wtb = fs.readFileSync(path.join(__dirname, '..', 'supply-what.js'), 'utf8');
  const pick = wtb.slice(wtb.indexOf('    function pickPriceLine('), wtb.indexOf('    async function pickSupplier('));
  const payload = wtb.slice(wtb.indexOf('  function overrideOf('), wtb.indexOf('  function ', wtb.indexOf('  function linePayload(') + 3));
  const target = { key: 'target', supplier_id: 7, supplier_name: 'БИС', name: 'Наружный блок 24',
    contract_id: 1, contract_item_id: 2, component_id: 3, qty: 2 };
  const sibling = { ...target, key: 'other', component_id: 4, qty: 1 };
  const overrides = { other: { supplier_id: 8, supplier_alias: 'Ранее выбранная модель' } };
  let choose, request, preview, reject = true;
  const ctx = {
    window: { openSupplyDraftBasket(options) {
      assert.equal(options.supplierId, 7);
      assert.equal(options.target, target);
      choose = options.apply;
    } },
    baskets: new Map(), groupKey: () => '7:1',
    target, lines: [target, sibling], overrides,
    async apiPost(url, data) {
      assert.equal(url, '/api/supply/what-to-buy/drafts');
      request = data;
      if (reject) throw Error('Сбой проверки');
      return { ok: true, data: { groups: [] } };
    },
    successfulPost: res => res.data,
    renderPreview: data => { preview = data; },
  };
  vm.runInNewContext(payload + pick + '\npickPriceLine(target, {supplier_id:7, contract_id:1, items:[target]});', ctx);
  const model = 'XG-JP70RHA-ODU (НС-1689590)';
  const extra = [{name: 'EH-1700', qty: 1, price: null}];
  await assert.rejects(choose(model, extra), /Сбой проверки/);
  assert.equal(overrides.target, undefined);
  reject = false;
  await choose(model, extra);
  assert.ok(request.dry_run);
  assert.deepEqual(Array.from(request.items, row => [row.component_id, row.supplier_id, row.supplier_alias, row.qty]), [
    [3, 7, 'XG-JP70RHA-ODU (НС-1689590)', 2], [4, 8, 'Ранее выбранная модель', 1],
  ]);
  assert.equal(overrides.target.supplier_alias, request.items[0].supplier_alias);
  assert.deepEqual(preview, { groups: [] });
  assert.equal(ctx.baskets.get('7:1').items, extra);
  await choose('Сохранённая позиция', []);
  assert.equal(ctx.baskets.size, 0);
  assert.equal(overrides.target.supplier_alias, 'Сохранённая позиция');
});
