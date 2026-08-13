const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const app1 = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const app2 = fs.readFileSync(path.join(root, 'app-2.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('форма производства содержит обязательный блок комплектации', () => {
  assert.match(html, /id="bom-options-section"/);
  assert.match(html, /Комплектация нагревателя/);
  assert.match(app2, /loadAssemblyBomConfiguration\(model\.id, presetBomSelections\)/);
  assert.match(app2, /Выберите ТЭН \/ вариант комплектации/);
  assert.match(css, /\.bom-config-option\.selected/);
});

test('выбор уходит и в очередь, и в прямое создание сборки', () => {
  const occurrences = app2.match(/bom_selections:\s*a\.bomSelections \|\| \{\}/g) || [];
  assert.equal(occurrences.length, 2);
  assert.match(app2, /previewUrl \+= '&bom_selections='/);
  assert.match(app2, /execution_type:[\s\S]{0,160}stainless[\s\S]{0,80}standard/);
  assert.match(app2, /const defaultOption = .*find\(option => option\.is_default\)/);
});

test('редактор BOM управляет точными артикулами и стандартным вариантом', () => {
  assert.match(app2, /async function openBomVariantEditor\(bomId\)/);
  assert.match(app2, /Добавить другой ТЭН/);
  assert.match(app2, /bom-variant-default-btn/);
  assert.match(app2, /Сделать стандартом модели/);
  assert.match(app2, /st\.options\.filter\(o => !!o\.is_default\)\.length !== 1/);
  assert.match(css, /\.bom-variant-editor-row\.is-default/);
  assert.match(app2, /method: 'PUT'/);
  assert.match(app2, /\/selection-group/);
  assert.match(app2, /!it\.selection_group_id/);
});

test('вариант ТЭНа можно сохранить только для позиции договора', () => {
  assert.match(app2, /function openContractBomSelection\(itemId, modelId\)/);
  assert.match(app2, /\/api\/contracts\/items\/.*\/bom-selection/);
  assert.match(app2, /Сохранить для заказа/);
  assert.match(app2, /Стандарт модели не изменится/);
  assert.match(app2, /contract_item_id:\s*a\.contractItemId \|\| null/g);
  assert.match(app2, /await selectModel\(pf\.model_id, orderBomSelections\)/);
});

test('карточка работы показывает зафиксированную комплектацию', () => {
  assert.match(app1, /Комплектация изделия/);
  assert.match(app1, /w\.bom_configuration/);
  assert.match(app1, /configured_power_kw/);
});
