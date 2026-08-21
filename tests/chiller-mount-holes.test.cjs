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

// holesOf / boltPad / boltCount — чистая арифметика, гоняем их без сцены.
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
  const code = section('const holesOf=', 'function boltClear(it){');
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
  // разметки нет, но база дала пятно лап — остаётся штатная четвёрка
  assert.equal(ctx.boltCount(item('x', { bolt: [190.5, 190.5] }), m), 4);
});

test('нет ни отверстий, ни лапы — крепёж не рисуем и в ведомость не пишем', () => {
  const ctx = sandbox({});
  const clamp = item('cslr-159-263-1-odf', { bolt: [0, 0], bolt_plane: 'none' });
  assert.equal(ctx.boltPad(clamp), null, 'база сказала: лапы нет');
  assert.equal(ctx.boltCount(clamp, { n: 4 }), 0, 'ведомость не должна обещать болты');
  // старый индекс без mh и без пятна — прежний путь по габариту жив
  const old = item('x', {});
  assert.deepEqual(Array.from(ctx.boltPad(old)), [300 - 60, 200 - 60]);
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

test('М6 есть в справочнике болтов: вентилятор крепится в крышку', () => {
  const blk = section('const BOLT={bolt8:', 'const boltMat=');
  assert.match(blk, /bolt6:\s*\{d:6/);
});
