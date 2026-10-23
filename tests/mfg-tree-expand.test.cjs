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

// Разделы: у «Балок монтажных» (1) два подраздела, «Чиллер» (4) — без детей.
const SECTIONS = [
  { id: 1, parent_id: null, name: 'БАЛКИ МОНТАЖНЫЕ' },
  { id: 2, parent_id: 1, name: 'Балка 1000' },
  { id: 3, parent_id: 1, name: 'Балка 1200' },
  { id: 4, parent_id: null, name: 'ЧИЛЛЕР' },
];

function treeContext() {
  const context = {
    state: { mfgSections: SECTIONS, mfgCollapsedSections: {}, mfgCurrentSection: null,
             mfgCurrentItem: null },
    localStorage: {
      _v: {},
      getItem(k) { return this._v[k] || null; },
      setItem(k, v) { this._v[k] = v; },
    },
    renderMfg() { context._renders = (context._renders || 0) + 1; },
  };
  const code = section('function _mfgTree()', 'function renderMfg()')
    + section('function _mfgPersistCollapsed()', 'async function loadMfgItems(');
  vm.runInNewContext(
    `${code}\nthis.select = selectMfgSection; this.toggle = toggleMfgSection;`,
    context
  );
  return context;
}

test('клик по разделу раскрывает его подразделы', async () => {
  const ctx = treeContext();
  ctx.state.mfgCollapsedSections['1'] = true;   // раздел свёрнут

  await ctx.select(1);

  assert.equal(ctx.state.mfgCurrentSection, 1);
  assert.equal(ctx.state.mfgCollapsedSections['1'], undefined, 'раздел должен раскрыться');
});

test('повторный клик по открытому разделу сворачивает его', async () => {
  const ctx = treeContext();

  await ctx.select(1);   // выбрали и раскрыли
  await ctx.select(1);   // тот же раздел — сворачиваем

  assert.equal(ctx.state.mfgCollapsedSections['1'], true);
  assert.equal(ctx.state.mfgCurrentSection, 1, 'раздел остаётся выбранным');
});

test('переход на другой раздел раскрывает его, а не сворачивает', async () => {
  const ctx = treeContext();
  ctx.state.mfgCollapsedSections['1'] = true;
  ctx.state.mfgCurrentSection = 4;

  await ctx.select(1);

  assert.equal(ctx.state.mfgCollapsedSections['1'], undefined);
});

test('раздел без подразделов просто открывается', async () => {
  const ctx = treeContext();

  await ctx.select(4);
  await ctx.select(4);

  assert.equal(ctx.state.mfgCurrentSection, 4);
  assert.deepEqual(Object.keys(ctx.state.mfgCollapsedSections), [],
    'сворачивать нечего — в состоянии ничего не копится');
});

test('состояние сворачивания переживает перезагрузку', async () => {
  const ctx = treeContext();

  await ctx.select(1);
  await ctx.select(1);

  assert.deepEqual(JSON.parse(ctx.localStorage.getItem('mfgCollapsedSections')), ['1']);
});

test('шеврон по-прежнему сворачивает без смены выбранного раздела', () => {
  const ctx = treeContext();
  ctx.state.mfgCurrentSection = 4;

  ctx.toggle(1, { stopPropagation() {} });

  assert.equal(ctx.state.mfgCollapsedSections['1'], true);
  assert.equal(ctx.state.mfgCurrentSection, 4);
});
