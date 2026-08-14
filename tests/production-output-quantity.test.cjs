const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-1.js'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало: ${from}`);
  assert.notEqual(end, -1, `Не найден конец: ${to}`);
  return source.slice(start, end);
}

test('фактическое количество сохраняется отдельно от плана', async () => {
  let request;
  let rendered;
  const context = {
    state: {
      _pkbDetailWork: {
        id: 42, qty: 1, output_qty: 1, status: 'packing', work_type: 'assembly',
      },
    },
    cache: { productionKanban: {} },
    hasPermission: () => true,
    prompt: () => '2',
    showToast: () => {},
    apiPatch: async (url, body) => {
      request = { url, body };
      return { ...context.state._pkbDetailWork, ...body };
    },
    renderProductionWorkDetail: value => { rendered = value; },
    pwcLoad: () => {},
  };
  const code = section(
    'async function editProductionOutputQty',
    'function renderProductionWorkDetail'
  );
  vm.runInNewContext(`${code}\nthis.editQty = editProductionOutputQty;`, context);

  await context.editQty(42, 1);

  assert.equal(request.url, '/api/production/works/42');
  assert.equal(request.body.output_qty, 2);
  assert.equal(rendered.qty, 1, 'плановое количество не меняется');
  assert.equal(rendered.output_qty, 2, 'фактическое количество обновлено');
  assert.equal(context.cache.productionKanban, null);
});

test('карточка показывает план и редактируемый факт', () => {
  const render = section(
    'function renderProductionWorkDetail',
    'function renderPkbDetailActions'
  );

  assert.match(render, /Изготовлено/);
  assert.match(render, /план:/);
  assert.match(render, /editProductionOutputQty/);
  assert.match(render, /w\.output_qty \|\| plannedQty/);
});
