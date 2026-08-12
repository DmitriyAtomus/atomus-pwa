const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'app-2.js'), 'utf8');
const start = app.indexOf('function renderProductionTree()');
const end = app.indexOf('// v2.45.189:', start);
const productionTree = app.slice(start, end);

test('выбор позиции использует те же категории, что и справочник', () => {
  assert.ok(start >= 0 && end > start, 'найден рендер дерева производства');
  assert.match(app, /categories: \(d && d\.categories\) \|\| \[\]/);
  assert.match(productionTree, /m\.category_id/);
  assert.match(productionTree, /m\.category_name/);
  assert.match(productionTree, /pcat:/);
  assert.match(productionTree, /sp-tree-category/);
});

test('пикер больше не выдумывает серии из артикула', () => {
  assert.doesNotMatch(productionTree, /<span>Серия /);
  assert.doesNotMatch(productionTree, /split\(\/\[-–\\s\]\+\//);
});

test('модель без категории остаётся доступной для выбора', () => {
  assert.match(productionTree, /withoutCategory\.push\(m\)/);
  assert.match(productionTree, /withoutCategory\.forEach/);
});

test('ЩУ-005.003 рендерится внутри назначенной категории ЩУ-005.000 АСУ', () => {
  const functionsStart = app.indexOf('function _prodPickItem(');
  const functionsSource = app.slice(functionsStart, end);
  const body = { innerHTML: '' };
  const context = {
    document: { getElementById: id => id === 'nom-picker-body' ? body : null },
    escapeHtml: value => String(value == null ? '' : value),
    state: {
      _nomPicker: {
        filter: '',
        openGroups: {
          'pd:1': true,
          'psg:1:10': true,
          'pcat:1:10:cat:500': true,
        },
        productionData: {
          directions: [{ id: 1, name: 'Щиты управления' }],
          categories: [{ id: 500, name: 'ЩУ-005.000 АСУ', parent_subgroup_id: 10 }],
          models: [{
            id: 503,
            direction_id: 1,
            subgroup_id: 10,
            subgroup_name: 'Влагозащищённые',
            category_id: 500,
            category_name: 'ЩУ-005.000 АСУ',
            article: 'ЩУ-005.003',
            name: 'ЩУ-005.003',
            is_active: true,
          }],
        },
      },
    },
  };
  vm.runInNewContext(functionsSource + '\nrenderProductionTree();', context);
  assert.match(body.innerHTML, /ЩУ-005\.000 АСУ/);
  assert.match(body.innerHTML, /ЩУ-005\.003/);
  assert.ok(
    body.innerHTML.indexOf('ЩУ-005.000 АСУ') < body.innerHTML.indexOf('ЩУ-005.003'),
    'категория идёт перед вложенной моделью',
  );
  assert.doesNotMatch(body.innerHTML, /Серия ЩУ-005/);
});
