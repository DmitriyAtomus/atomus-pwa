// Компоновка проекта (chiller/project.html): точное позиционирование (v2.46.001).
// Кнопки сцены ставят деталь «на 90° и на 50 мм»; панель координат даёт числа —
// X/Y по центру детали, Z по отметке низа, углы по трём осям с шагом от 1°.
// Проверяем разметку, привязки и саму арифметику блока на заглушках сцены.
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

test('панель координат есть в разметке, кнопка — в панели выделения', () => {
  assert.match(page, /id="bPos"[^>]*>⌖ Координаты/);
  ['pX', 'pY', 'pZ', 'pRZ', 'pRY', 'pRX'].forEach(id =>
    assert.match(page, new RegExp('id="' + id + '" type="number"'), 'нет поля ' + id));
  assert.match(page, /id="posSteps"/);          // шаг в мм
  assert.match(page, /id="posASteps"/);         // шаг в градусах
  assert.match(page, /мм · отм\. низа/);        // Z — это отметка, а не origin меша
  assert.match(page, /мм · центр/);
  assert.match(page, /id="posRot"/);            // предупреждение про вентиль на штуцере
  assert.match(page, /\$\('#bPos'\)\.onclick=posToggle/);
  assert.match(page, /G — точные координаты и углы/);   // подсказка на сцене
});

test('панель открывается клавишей G и пунктом меню, закрывается по Esc', () => {
  const keys = section("addEventListener('keydown'", 'function roleOf');
  assert.match(keys, /e\.key==='g'\|\|e\.key==='G'\|\|e\.key==='п'\|\|e\.key==='П'\)posToggle\(\)/);
  // Esc из поля панели закрывает панель, а не чат
  assert.match(keys, /e\.target\.closest\('#pos'\)\)\{\s*e\.target\.blur\(\);posHide\(\);return;\}/);
  assert.match(keys, /if\(posOn\(\)\)\{posHide\(\);return;\}/);
  assert.match(page, /t:'Точные координаты…',s:'G'/);
});

test('числа в панели не отстают от сцены', () => {
  // выделили другую деталь / сняли выделение
  assert.match(page, /sel\?posFill\(\):posHide\(\);/);
  // подъём, поворот, посадка на пол — всё идёт через showSelZ
  assert.match(section('function showSelZ()', 'function lift('), /posFill\(\);/);
  // и перетаскивание мышью
  assert.match(section("cv.addEventListener('pointermove'", 'const off=()=>'),
    /checkCollisions\(\);save\(\);posFill\(\);/);
});

/* ── арифметика блока: гоняем настоящий код на заглушках сцены ── */
function el() {
  const cls = new Set();
  return {
    value: '', disabled: false, textContent: '', dataset: {}, style: {}, onclick: null,
    onchange: null, onkeydown: null, cls,
    classList: {
      add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c),
      toggle: (c, on) => (on === undefined ? (cls.has(c) ? cls.delete(c) : cls.add(c))
                                          : on ? cls.add(c) : cls.delete(c)),
    },
    querySelectorAll: () => [],
    appendChild() {}, remove() {}, closest: () => null,
  };
}
function stand() {
  const code = section('const POS={step:10,ang:1};', '/* ═══ v2.45.995');
  const els = {};
  const box = {
    sel: null, saved: 0, hist: [], toasts: [], collided: 0, reseated: 0, mated: 0,
    $(id) { return (els[id] = els[id] || el()); },
    el: id => els[id],
    document: { createElement: () => el(), activeElement: null },
    toast(t) { box.toasts.push(t); },
    save() { box.saved++; },
    pushHist(t) { box.hist.push(t); },
    checkCollisions() { box.collided++; },
    refresh() {}, showSelZ() {}, hideMnt() {},
    reseatLink() { box.reseated++; },
    rotMate() { box.mated++; },
    THREE: {
      Vector3: class { constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; } },
      Box3: class {
        setFromObject(o) {
          const s = o.size;
          this.min = { x: o.position.x - s.x / 2, y: o.position.y - s.y / 2, z: o.position.z };
          this.max = { x: o.position.x + s.x / 2, y: o.position.y + s.y / 2, z: o.position.z + s.z };
          return this;
        }
        getCenter(v) { v.x = (this.min.x + this.max.x) / 2; v.y = (this.min.y + this.max.y) / 2;
                       v.z = (this.min.z + this.max.z) / 2; return v; }
        getSize(v) { v.x = this.max.x - this.min.x; v.y = this.max.y - this.min.y;
                     v.z = this.max.z - this.min.z; return v; }
      },
    },
    // деталь двигаем так же, как сцена: вместе с посаженным на неё
    moveItem(it, dx, dy, dz) {
      it.obj.position.x += dx; it.obj.position.y += dy; it.obj.position.z += dz;
      box.moved = { dx, dy, dz };
    },
  };
  vm.createContext(box);
  vm.runInContext(code, box);
  box.peek = expr => vm.runInContext(expr, box);
  box.put = (x, y, z, sx, sy, sz) => {
    const it = {
      d: { brand: 'Ридан', name: 'узел' }, pin: false, link: null,
      obj: { position: { x, y, z }, rotation: { x: 0, y: 0, z: 0 }, size: { x: sx, y: sy, z: sz },
             updateMatrixWorld() {} },
    };
    box.sel = it;
    return it;
  };
  box.$('#pos').classList.add('on');
  return box;
}

test('X/Y ведут центр детали, Z — отметку низа', () => {
  const s = stand();
  const it = s.put(0, 0, 0, 800, 600, 1200);
  s.peek('posMove("x", 1250)');
  assert.equal(it.obj.position.x, 1250, 'центр по X встал на 1250');
  s.peek('posMove("z", 700)');
  assert.equal(it.obj.position.z, 700, 'низ детали — на отметке 700');
  assert.deepEqual(s.hist, ['точное положение детали', 'точное положение детали']);
  assert.ok(s.saved >= 2, 'каждая правка сохраняется в проект');
  // повтор того же числа сцену не трогает и лишний шаг истории не пишет
  s.peek('posMove("z", 700)');
  assert.equal(s.hist.length, 2);
});

test('шаг ± берётся из чипов и работает от 1 мм', () => {
  const s = stand();
  const it = s.put(0, 0, 0, 400, 400, 400);
  s.peek('POS.step=1');
  s.peek('posNudge("y", 1)');
  assert.equal(it.obj.position.y, 1);
  s.peek('POS.step=50');
  s.peek('posNudge("y", -1)');
  assert.equal(it.obj.position.y, -49);
});

test('поворот встаёт на любой угол, а завал не роняет деталь под пол', () => {
  const s = stand();
  const it = s.put(0, 0, 300, 400, 400, 400);
  s.peek('posSpin("z", 7)');
  assert.ok(Math.abs(it.obj.rotation.z - 7 * Math.PI / 180) < 1e-9, 'ровно 7°');
  assert.deepEqual(s.hist, ['поворот детали']);
  s.peek('POS.ang=1; posTurn("z", 1)');
  assert.ok(Math.abs(it.obj.rotation.z - 8 * Math.PI / 180) < 1e-9, 'шаг 1° прибавился');
  s.peek('posSpin("y", 90)');
  assert.equal(it.obj.position.z, 300, 'после завала низ остался на прежней отметке');
});

test('вентиль на штуцере: место не трогаем, вокруг оси крутим на любой угол', () => {
  const s = stand();
  const it = s.put(0, 0, 500, 100, 100, 200);
  it.link = { to: 3, mount: 'rot', zi: 1, roll: 0 };
  s.peek('posMove("x", 900)');
  assert.equal(it.obj.position.x, 0, 'вентиль остался на патрубке');
  assert.ok(s.toasts.some(t => /сними с патрубка/.test(t)));
  s.peek('posSpin("z", 30)');
  assert.ok(Math.abs(it.link.roll - 30 * Math.PI / 180) < 1e-9, 'повернулся на 30° вокруг оси');
  assert.equal(s.mated, 1, 'после поворота вентиль заново садится на штуцер');
  assert.deepEqual(s.hist, ['поворот вентиля на штуцере']);
});

test('закреплённую деталь точный ввод двигает, но говорит об этом', () => {
  const s = stand();
  const it = s.put(0, 0, 0, 400, 400, 400);
  it.pin = true;
  s.peek('posMove("x", 120)');
  assert.equal(it.obj.position.x, 120);
  assert.ok(s.toasts.some(t => /закреплена/.test(t)));
});

test('поля отключаются для вентиля на штуцере и показывают габарит', () => {
  const s = stand();
  const it = s.put(0, 0, 0, 800, 600, 1200);
  s.peek('posFill()');
  assert.equal(s.el('#pX').value, 0);
  assert.equal(s.el('#pZ').value, 0);
  assert.match(s.el('#posDim').textContent, /габарит 800 × 600 × 1200 мм/);
  it.link = { to: 2, mount: 'rot', zi: 0, roll: Math.PI / 2 };
  s.peek('posFill()');
  assert.equal(s.el('#pX').disabled, true, 'место вентиля задаёт патрубок');
  assert.equal(s.el('#pRZ').disabled, false, 'а вокруг оси штуцера крутить можно');
  assert.equal(s.el('#pRZ').value, 90);
  assert.equal(s.el('#posRot').style.display, 'block');
});
