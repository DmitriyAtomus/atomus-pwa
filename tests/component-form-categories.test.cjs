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

const CATS = [
  { id: 3, name: 'Сантехника' },
  { id: 7, name: 'Холодильное' },
];

function formContext(opts) {
  const o = opts || {};
  const modal = {
    id: 'comp-form-modal', innerHTML: '', className: '',
    classList: { add() {}, remove() {} },
    querySelector: () => null,
    set onclick(v) {},
  };
  const context = {
    cache: {
      components: o.components || [],
      componentCategories: o.cachedCats,
      suppliers: [],
      supplyCatalog: [],
      models: { models: [] },
    },
    state: {},
    window: {},
    document: {
      getElementById: () => modal,
      createElement: () => modal,
      body: { appendChild() {} },
    },
    canManageSales: () => true,
    setTimeout(fn) { return 0; },
    showToast(msg, type) { context.toast = { msg, type }; },
    escapeHtml: (v) => String(v == null ? '' : v),
    _cfAutoUnit() {},
    async apiGet(url) {
      context.calls = (context.calls || []).concat(url);
      if (url === '/api/components/categories') return { categories: o.serverCats || [] };
      if (url === '/api/suppliers') return { suppliers: [] };
      if (url === '/api/supply-items') return { items: [] };
      return {};
    },
  };
  context.window = context;
  const code = section('async function openComponentForm(componentId)', 'function _cfAutoUnit(');
  vm.runInNewContext(`${code}\nthis.open = openComponentForm; this.modal = () => (${JSON.stringify(null)});`, context);
  context._modal = modal;
  return context;
}

test('категории подтягиваются, даже если форму открыли не со склада', async () => {
  const ctx = formContext({
    cachedCats: undefined,          // кэш пуст — так бывает при заходе из «Что закупить»
    serverCats: CATS,
    components: [{ id: 5, name: 'Колено d100', category_id: 3, min_stock: 6 }],
  });

  await ctx.open(5);

  assert.ok(ctx.calls.includes('/api/components/categories'), 'справочник запрошен');
  assert.match(ctx._modal.innerHTML, /<option value="3" selected>Сантехника<\/option>/);
  assert.match(ctx._modal.innerHTML, /<option value="7">Холодильное<\/option>/);
  assert.doesNotMatch(ctx._modal.innerHTML, /— нет категорий —/);
});

test('уже загруженный справочник повторно не тянется', async () => {
  const ctx = formContext({
    cachedCats: CATS,
    components: [{ id: 5, name: 'Колено d100', category_id: 7 }],
  });

  await ctx.open(5);

  assert.ok(!(ctx.calls || []).includes('/api/components/categories'));
  assert.match(ctx._modal.innerHTML, /<option value="7" selected>Холодильное<\/option>/);
});

test('категория, которой нет в справочнике, не подменяется первой', async () => {
  const ctx = formContext({
    cachedCats: CATS,
    components: [{ id: 5, name: 'Колено d100', category_id: 42, category_name: 'Старая группа' }],
  });

  await ctx.open(5);

  assert.match(ctx._modal.innerHTML,
    /<option value="42" selected>Старая группа \(нет в справочнике\)<\/option>/);
  // ни одна из существующих категорий не помечена выбранной
  assert.doesNotMatch(ctx._modal.innerHTML, /<option value="3" selected>/);
});

test('когда категорий нет вообще — честная надпись, а не пустой список', async () => {
  const ctx = formContext({ cachedCats: undefined, serverCats: [], components: [] });

  await ctx.open();

  assert.match(ctx._modal.innerHTML, /— нет категорий —/);
});

test('без категории сохранение по-прежнему не проходит', () => {
  const submit = section('async function submitComponentForm(componentId)', 'async function deleteComponent');
  assert.match(submit, /if \(!data\.category_id\) \{ showToast\('Выбери категорию', 'error'\); return; \}/);
});
