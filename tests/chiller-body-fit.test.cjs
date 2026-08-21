// Компоновка проекта (chiller/project.html): деталь не лезет сквозь панель корпуса
// и клик по корпусу снова подсвечивает (v2.45.1008).
// Раскладка по функциям сажала деталь «в долю наружного габарита» — компрессор
// упирался в стенку, ресивер вылезал наружу, а строка состояния молчала:
// корпус в расчёт пересечений не берётся. Здесь проверяем и разметку, и саму
// арифметику полости на заглушках сцены.
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

test('клик по корпусу отдаёт корпус, а деталь за панелью — деталь', () => {
  const pick = section('function pickItem(e,any)', 'function planePoint');
  // за панелью деталь — берём её; ничего внутри нет — сам корпус, а не null
  assert.match(pick, /return inner\|\|list\[0\]\|\|null;/);
  assert.doesNotMatch(pick, /sel===fr\?fr:null/);
  // первый клик по корпусу только подсвечивает, тащится он вторым нажатием
  const down = section("cv.addEventListener('pointerdown'", "cv.addEventListener('pointermove'");
  assert.match(down, /const frameFirst=FRMTHRU&&roleOf\(hit\.d\)==='frame'&&sel!==hit;/);
  assert.match(down, /select\(hit\);\s*if\(frameFirst\)\{mode='orbit';return;\}/);
  // подсказка на сцене говорит то же самое
  assert.match(page, /по пустой панели — сам корпус \(тащится вторым нажатием\)/);
});

test('строка состояния считает и торчащие наружу детали', () => {
  const coll = section('function checkCollisions()', 'function fitAllInside()');
  assert.match(coll, /collSet=new Set\(\);checkOutside\(\);/);
  assert.match(coll, /⚠ вне корпуса: '\+o\+' дет\./);
  assert.match(coll, /✓ пересечений нет, всё в корпусе/);
  assert.match(coll, /el\.onclick=\(o\|\|h\)\?fitAllInside:null;/); // строка — она же кнопка (жмётся и при пересечениях)
  // янтарная подсветка торчащей детали
  assert.match(section('function applyTint(p)', 'function checkOutside()'),
    /outSet\.has\(p\.uid\)\)\{m\.emissive\.setHex\(0xC9A227\)/);
  // и пункт меню по ПКМ
  assert.match(page, /t:'Убрать в корпус'/);
});

/* ── арифметика полости: гоняем настоящий код на заглушках сцены ── */
function stand(frame, top) {
  const code = section('const WALL=30;', '/* роли, которые живут внутри') +
               section('function clampInside(it,box,zone)', 'function levelZ(');
  const box = {
    SNAP: 10,
    snap: v => Math.round(v / 10) * 10,
    placed: [{ d: { section: 'frames' }, obj: frame }],
    roleOf: d => (d.section === 'frames' ? 'frame' : 'comp'),
    capTop: () => ({ z: top }),
    site: () => new box.THREE.Box3(
      new box.THREE.Vector3(frame.min.x, frame.min.y, frame.min.z),
      new box.THREE.Vector3(frame.max.x, frame.max.y, frame.max.z)),
    THREE: {
      Vector3: class { constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; } },
      Box3: class {
        constructor(min, max) { if (min) { this.min = min; this.max = max; } }
        setFromObject(o) {
          const s = o.size;
          this.min = { x: o.position.x - s.x / 2, y: o.position.y - s.y / 2, z: o.position.z };
          this.max = { x: o.position.x + s.x / 2, y: o.position.y + s.y / 2, z: o.position.z + s.z };
          return this;
        }
      },
    },
  };
  vm.createContext(box);
  vm.runInContext(code, box);
  return box;
}
const FRAME = { min: { x: -450, y: -303, z: 0 }, max: { x: 450, y: 303, z: 899 } };
const part = (x, y, w, d, h) => ({
  position: { x, y, z: 0 }, size: { x: w, y: d, z: h }, updateMatrixWorld() {},
});

test('полость — это габарит корпуса без толщины панели', () => {
  const s = stand(FRAME, 880);
  const z = s.siteIn();
  assert.deepEqual([z.min.x, z.min.y, z.max.x, z.max.y], [-420, -273, 420, 273]);
  assert.equal(z.max.z, 880, 'верх полости — крышка, а не верх габарита');
});

test('деталь, наехавшая на панель, уезжает внутрь целиком', () => {
  const s = stand(FRAME, 880);
  // компрессор 302 мм шириной стоит серединой в левой стенке
  const it = { obj: part(-420, 0, 302, 243, 418) };
  const b = s.clampInside(it, new s.THREE.Box3().setFromObject(it.obj));
  assert.ok(b.min.x >= -420, 'левый край всё ещё в панели: ' + b.min.x);
  // сдвиг кратен шагу сетки и округлён от стенки, а не «к ближайшему»
  assert.equal(Math.abs(it.obj.position.x % 10), 0);
  assert.ok(b.min.x - (-420) < 10, 'уехала внутрь дальше, чем на шаг сетки: ' + b.min.x);
});

test('сдвиг меньше шага сетки не теряется', () => {
  const s = stand(FRAME, 880);
  const it = { obj: part(-273, 0, 302, 243, 418) };   // край на 4 мм в панели
  const before = it.obj.position.x;
  s.clampInside(it, new s.THREE.Box3().setFromObject(it.obj));
  assert.equal(it.obj.position.x - before, 10, 'округление съело сдвиг на 4 мм');
  assert.ok(new s.THREE.Box3().setFromObject(it.obj).min.x >= -420);
});

test('деталь шире полости встаёт по центру, а не одним боком наружу', () => {
  const s = stand(FRAME, 880);
  const it = { obj: part(100, 0, 1000, 200, 300) };   // шире корпуса
  const b = s.clampInside(it, new s.THREE.Box3().setFromObject(it.obj));
  assert.ok(Math.abs((b.min.x + b.max.x) / 2) < 10);
});

test('деталь, уже стоящая внутри, не двигается', () => {
  const s = stand(FRAME, 880);
  const it = { obj: part(0, 0, 200, 200, 200) };
  s.clampInside(it, new s.THREE.Box3().setFromObject(it.obj));
  assert.equal(it.obj.position.x, 0);
  assert.equal(it.obj.position.y, 0);
});
