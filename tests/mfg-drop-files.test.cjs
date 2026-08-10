const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app-4.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

function file(name) {
  return { name, size: 1024 };
}

function quickContext() {
  const context = {
    state: { mfgSections: [{ id: 52, name: 'ФЛАНЕЦ' }], mfgItems: [] },
    toasts: [],
    showToast(msg, type) { context.toasts.push({ msg, type }); },
    renderMfgItem() {},
    mfgUploadFiles(itemId, files) { context.uploaded = { itemId, names: files.map(f => f.name) }; },
    async apiPost(url, body) {
      context.posted = { url, body };
      return { ok: true, data: { id: 99 } };
    },
    async apiGet(url) {
      context.got = url;
      return { id: 42, designation: 'AG-39.000.000СБ', parts: [], files: [] };
    },
  };
  const code = section('// v2.45.882: что именно взяли в работу', '// журнал всех заказов на изготовление');
  vm.runInNewContext(`${code}\nthis.quick = mfgQuickFiles; this.sort = _mfgSortFiles;`, context);
  return context;
}

test('перетаскивание ловится всей панелью раздела и карточкой изделия', () => {
  assert.match(source, /_mfgWireDropHost\(main, \(files\) => mfgQuickFiles\(sectionId, files\)\)/);
  assert.match(source, /_mfgWireDropHost\(main, \(files\) => mfgUploadFiles\(it\.id, files\)\)/);
  // подсветка показывает, куда именно упадёт файл
  assert.match(css, /\.mfg-main\.mfg-drop-on\s*\{/);
});

test('бросок без файлов объясняет, что случилось', () => {
  const wire = section('function _mfgWireDropHost(host, onFiles)', 'function mfgQuickDrop(');
  assert.match(wire, /showToast\('Файлов в перетаскивании не оказалось/);
  // dragenter/dragleave считаются глубиной — рамка не мигает на дочерних элементах
  assert.match(wire, /depth = Math\.max\(0, depth - 1\)/);
});

test('годные файлы отбираются, лишние перечисляются', () => {
  const ctx = quickContext();

  const res = ctx.sort([file('AG-39.000.000СБ.dxf'), file('чертёж.pdf'),
    file('модель.step'), file('сборка.STP'), file('модель.sldprt'), file('фото.JPG')]);

  assert.deepEqual(JSON.parse(JSON.stringify(res.ok.map(f => f.name))),
    ['AG-39.000.000СБ.dxf', 'чертёж.pdf', 'модель.step', 'сборка.STP']);
  assert.deepEqual(JSON.parse(JSON.stringify(res.skippedExt)), ['.sldprt', '.jpg']);
});

test('когда разбирать нечего — изделие не создаётся', async () => {
  const ctx = quickContext();

  await ctx.quick(52, [file('модель.sldprt'), file('фото.jpg')]);

  assert.equal(ctx.posted, undefined, 'пустая карточка изделия не появляется');
  assert.match(ctx.toasts[0].msg, /нечего разбирать/);
  assert.match(ctx.toasts[0].msg, /\.sldprt/);
  assert.equal(ctx.toasts[0].type, 'error');
});

test('STEP уходит в изделие вместе с архивом', async () => {
  const ctx = quickContext();

  await ctx.quick(52, [file('AG-39.000.000СБ Кронштейн.zip'), file('модель.step')]);

  assert.equal(ctx.posted.url, '/api/mfg/items');
  assert.equal(ctx.posted.body.section_id, 52);
  assert.equal(ctx.posted.body.designation, 'AG-39.000.000СБ');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.uploaded.names)),
    ['AG-39.000.000СБ Кронштейн.zip', 'модель.step']);
  assert.doesNotMatch(ctx.toasts.map(t => t.msg).join(' | '), /пропускаю \.step/);
});

test('повторный STEP добавляется в существующее изделие, а не создаёт дубль', async () => {
  const ctx = quickContext();
  ctx.state.mfgItems = [
    { id: 42, designation: 'AG-39.000.000СБ', parts_count: 18 },
  ];

  await ctx.quick(52, [file('AG-39.000.000СБ Корпус.step')]);

  assert.equal(ctx.posted, undefined);
  assert.equal(ctx.got, '/api/mfg/items/42');
  assert.equal(ctx.uploaded.itemId, 42);
});

test('сорванный запрос виден человеку, а не только в консоли', async () => {
  const ctx = quickContext();
  ctx.apiPost = async () => { throw new Error('Failed to fetch'); };

  await ctx.quick(52, [file('AG-39.000.000СБ.dxf')]);

  assert.match(ctx.toasts.map(t => t.msg).join(' | '), /Не дошло до сервера: Failed to fetch/);
});
