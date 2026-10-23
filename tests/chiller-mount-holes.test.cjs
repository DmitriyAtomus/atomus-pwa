// Крепление узла в компоновке (chiller/project.html): болт садится в
// размеченное монтажное отверстие модели, а не в угол габаритной коробки
// (задача #894). Разметку даёт база 3D полем mh в индексе геометрий:
// точка p, ось dir, Ø d, толщина лапы t, штатный крепёж thr.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'chiller', 'project.html'), 'utf8');

function section(from, to) {
  const a = page.indexOf(from);
  const b = page.indexOf(to, a);
  assert.notEqual(a, -1, 'не нашёл начало блока: ' + from);
  assert.notEqual(b, -1, 'не нашёл конец блока: ' + to);
  return page.slice(a, b);
}

// holesOf / boltPad / boltCount / boltIssue — чистая арифметика, гоняем их без сцены.
// THREE подменяем заглушкой: из него здесь нужен только габарит детали.
function sandbox(geoms) {
  const THREE = {
    Vector3: class { constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; } },
    Box3: class {
      setFromObject() { return this; }
      getSize(v) { v.x = 300; v.y = 200; v.z = 400; return v; }
    },
    Quaternion: class {},
  };
  const code = section('const BOLT={bolt8:', 'const boltMat=') +
    section('const holesOf=', 'function boltClear(it){');
  const ctx = { THREE, GEOMS: geoms || {} };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  // const-объявления в контекст сами не попадают — достаём стрелку явно
  ctx.holesOf = vm.runInContext('holesOf', ctx);
  return ctx;
}

const HOLES = [
  { p: [-95.2, -95.2, 0], dir: [0, 0, 1], d: 13.46, t: 13, thr: 'М12', kind: 'foot' },
  { p: [95.2, -95.2, 0], dir: [0, 0, 1], d: 13.46, t: 13, thr: 'М12', kind: 'foot' },
  { p: [95.2, 95.2, 0], dir: [0, 0, 1], d: 13.46, t: 13, thr: 'М12', kind: 'foot' },
  { p: [-95.2, 95.2, 0], dir: [0, 0, 1], d: 13.46, t: 13, thr: 'М12', kind: 'foot' },
];
const item = (g, geom) => ({ obj: {}, d: { g: g, geom: geom || {} } });

test('разметка отверстий берётся из индекса базы', () => {
  const ctx = sandbox({ 'yh-small-418': { mh: HOLES } });
  assert.equal(ctx.holesOf(item('yh-small-418')).length, 4);
  assert.equal(ctx.holesOf(item('нет-такой')).length, 0, 'чужой ключ — пусто');
  assert.equal(ctx.holesOf(null).length, 0, 'без детали не падаем');
  assert.equal(ctx.holesOf({ obj: {} }).length, 0, 'у бака ключа геометрии нет');
});

test('болтов столько, сколько отверстий, а не всегда четыре', () => {
  const ctx = sandbox({ 'fan-450-R': { mh: new Array(6).fill(HOLES[0]) } });
  const m = { n: 4 };
  assert.equal(ctx.boltCount(item('fan-450-R'), m), 6, 'у рамы вентилятора шесть');
  // Одного старого «пятна лап» недостаточно: оно не говорит, где отверстия.
  assert.equal(ctx.boltCount(item('x', { bolt: [190.5, 190.5] }), m), 0,
    'нельзя придумывать четыре болта по углам пятна');
});

test('без точной разметки крепёж не рисуем и в ведомость не пишем', () => {
  const ctx = sandbox({});
  const clamp = item('cslr-159-263-1-odf', { bolt: [0, 0], bolt_plane: 'none' });
  assert.equal(ctx.boltPad(clamp), null, 'база сказала: лапы нет');
  assert.equal(ctx.boltCount(clamp, { n: 4 }), 0, 'ведомость не должна обещать болты');
  // Старый индекс и даже известный шаг лап не дают центров отверстий.
  const old = item('x', {});
  assert.equal(ctx.boltPad(old), null);
  assert.equal(ctx.boltPad(item('x', { bolt: [190.5, 190.5] })), null);
  assert.equal(ctx.boltCount(old, { n: 4 }), 0);
});

test('без mh пользователь видит, что нужна разметка отверстий', () => {
  const ctx = sandbox({ 'yh-small-418': { mh: HOLES } });
  const issue = ctx.boltIssue(item('rmhi-3', { bolt: [120, 90] }), { n: 4 });
  assert.match(issue, /нет разметки монтажных отверстий/i);
  assert.match(issue, /нужна разметка/i);
  assert.equal(ctx.boltIssue(item('yh-small-418'), { n: 4 }), '',
    'для размеченной модели предупреждения нет');
});

test('крепёж строится в системе координат модели и едет по её матрице', () => {
  const blk = section('function boltHoles(it,m,H){', 'function boltMark(it){');
  // ось отверстия и точка — из разметки, а не из габарита
  assert.match(blk, /h\.dir/);
  assert.match(blk, /setFromUnitVectors\(_bZ,d\)/);
  assert.match(blk, /grp\.userData\.mh=1/);
  const sync = section('function boltSync(it){', 'function boltsSync()');
  assert.match(sync, /_bolts\.matrix\.copy\(it\.obj\.matrixWorld\)/,
    'группа крепежа должна повторять матрицу детали — иначе поворот её уводит');
});

test('размер болта берётся из штатного thr отверстия, а не из случайной кнопки', () => {
  const dict = section('const BOLT={bolt8:', 'const boltMat=');
  assert.match(dict, /bolt6:\s*\{d:6/);
  const blk = section('function boltHoles(it,m,H){', 'function boltMark(it){');
  assert.match(blk, /boltForHole\(h,m\)/);
  const spec = section('// v2.45.994: крепёж посадки', "$('#spec').querySelectorAll");
  assert.match(spec, /boltBom\(p/,
    'BOM должен следовать реальному М6/М8/М10 из каждого отверстия');
  const link = section('function linkSel(mount,face){', 'function tankRelOf');
  assert.match(link, /mount=boltMountOf\(sel,mount\)/,
    'в сохранённой связи тоже должен остаться фактический, а не нажатый размер');
});

test('фактический М6 сохраняется в связи, даже если нажали общую кнопку М10', () => {
  const mh = HOLES.map(h => Object.assign({}, h, { d: 6.6, thr: 'М6' }));
  const ctx = sandbox({ 'pedrollo-pk65': { mh } });
  assert.equal(ctx.boltMountOf(item('pedrollo-pk65'), 'bolt10'), 'bolt6');
  assert.equal(ctx.boltCount(item('pedrollo-pk65'), { d: 10 }), 4);
});

test('гайка и нижняя шайба прижаты к основанию, а не висят на конце болта', () => {
  const blk = section('function boltHoles(it,m,H){', 'function boltMark(it){');
  assert.match(blk, /supportT/);
  assert.match(blk, /lowerWasher/);
  assert.doesNotMatch(blk, /put\(m\.hd\/2,m\.hh,-m\.ln\)/,
    'старая гайка висела на расстоянии полной длины болта от основания');
});

test('группы крепежа очищаются при очистке сцены и при undo удаления', () => {
  const clear = section("$('#bClear').onclick", "$('#bBom').onclick");
  assert.match(clear, /boltClear\(p\)/);
  const hist = section('async function histApply(snapshot){', 'async function histGo(back){');
  assert.match(hist, /scene\.remove\(p\.obj\);boltClear\(p\)/,
    'иначе после undo/redo в сцене остаются висячие дубликаты болтов');
});

test('меню не обещает четыре болта до чтения реальных отверстий', () => {
  const menu = section('<div id="mnt">', '<div id="pos">');
  assert.doesNotMatch(menu, /Болты М(?:6|8|10) <small>· 4 шт/);
  assert.match(menu, /по штатным отверстиям/);
});

test('М6 есть в справочнике болтов: вентилятор крепится в крышку', () => {
  const blk = section('const BOLT={bolt8:', 'const boltMat=');
  assert.match(blk, /bolt6:\s*\{d:6/);
});
