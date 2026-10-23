// Компоновка проекта (chiller/project.html): поворот детали по трём осям и
// посадка на корпус — внутрь на дно или сверху на крышку.
// Крышка корпуса 00.000.003 имеет монтажный проём Ø490 со смещённым центром
// (X = 50, Y = −3,125) — конденсатор надевается ровно на него, поэтому центр
// проёма ищем лучами по мешу, а не берём середину листа.
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

test('в панели детали есть все три оси поворота', () => {
  assert.match(page, /id="bRot"/);
  assert.match(page, /id="bTilt"/);
  assert.match(page, /id="bRoll"[^>]*>⤾ крен 90°/);
  // кнопки и клавиши ведут в одну функцию — иначе одна из осей отвалится молча
  assert.match(page, /\$\('#bRoll'\)\.onclick=rollSel/);
  assert.match(page, /const rollSel=\(\)=>spinSel\('x'\)/);
  assert.match(page, /const tiltSel=\(\)=>spinSel\('y'\)/);
  assert.match(page, /const rotSel\s*=\(\)=>spinSel\('z'\)/);
});

test('крен сохраняется в проект и возвращается при открытии', () => {
  assert.match(page, /k:p\.obj\.rotation\.x/);                 // в payload
  assert.match(page, /async function addItem\(d,at,rot,tilt,roll\)/);
  assert.match(page, /obj\.rotation\.set\(roll\|\|0,tilt\|\|0,rot\|\|0\)/);
  assert.match(page, /addItem\(d,\{x:s\.x,y:s\.y,z:s\.z,\s*state:[^)]*\},s\.r,s\.t,s\.k\)/);
});

test('в меню крепления две плоскости: дно и крышка', () => {
  const mnt = section('<div id="mnt">', '<div id="selbar">');
  assert.match(mnt, /data-m="bolt8" data-f="pan"/);
  assert.match(mnt, /data-m="bolt8" data-f="cap"/);
  assert.match(mnt, /Сверху, на крышку/);
  // плоскость доезжает до обработчика и сохраняется в связи
  assert.match(page, /linkSel\(o\.dataset\.m,o\.dataset\.f\)/);
  assert.match(page, /sel\.link=\{to:fr\.uid,mount:mount,face:face\}/);
  assert.match(page, /face:p\.link\.face\|\|'pan'/);
});

test('крышку ищем по обозначению 00.000.003, а конденсатор садится на неё', () => {
  assert.match(page, /\/крышк\/i\.test\(x\.name\)\|\|\/00\\\.000\\\.003\/\.test\(x\.des\)/);
  // авто-расстановка кладёт крышный ярус на крышку, а не на верх габарита
  assert.match(page, /if\(lvl==='roof'\)\{[\s\S]{0,160}capTop\(fr\)\.z/);
});

// ── центр проёма: гоняем capHole на модели крышки с круглой дырой ──
function runCapHole(hole) {
  const code = section('function capHole(fr,bb)', 'function frameFor(it)');
  class Vector3 {
    constructor(x, y, z) { this.set(x || 0, y || 0, z || 0); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  }
  class Raycaster {
    constructor() { this.far = Infinity; }
    set(origin, dir) { this.ray = { origin: { x: origin.x, y: origin.y }, dir }; return this; }
    intersectObject() {
      const { x, y } = this.ray.origin;
      const r = Math.hypot(x - hole.x, y - hole.y);
      // внутри проёма металла нет — луч уходит в пустоту
      return r <= hole.r ? [] : [{ point: { x, y, z: 899 }, distance: 5 }];
    }
  }
  const ctx = { THREE: { Vector3, Raycaster }, result: null };
  vm.createContext(ctx);
  vm.runInContext(code + '\nresult = capHole({}, bb);', Object.assign(ctx, {
    bb: { min: { x: -450, y: -303, z: 897 }, max: { x: 450, y: 303, z: 899 } },
  }));
  return ctx.result;
}

test('центр монтажного проёма находится по мешу, со смещением от середины листа', () => {
  const got = runCapHole({ x: 50, y: -3.125, r: 245 });
  assert.ok(got, 'проём не найден');
  assert.ok(Math.abs(got.x - 50) < 25, 'центр по X уехал: ' + got.x);
  assert.ok(Math.abs(got.y + 3.125) < 25, 'центр по Y уехал: ' + got.y);
  assert.ok(Math.abs(got.w - 490) < 80, 'ширина проёма: ' + got.w);
});

test('глухая крышка — проёма нет, деталь садится там, где стояла', () => {
  assert.equal(runCapHole({ x: 0, y: 0, r: -1 }), null);
});

test('обечайка Belief входит в проём, а плоская панель прижата к низу крыши', () => {
  const code = section('const CAP_T=1;', '/* Круглый проём в верхней плоскости детали:');
  const ctx = { result: null };
  vm.createContext(ctx);
  vm.runInContext(code + `
    const it={d:{name:'Belief BS-ACV-G8-145-A13'}};
    const st={z:899},b={max:{z:200}};
    const dz=condSeatDz(it,st,b);
    result={neck:condNeckProjection(it),dz:dz,top:b.max.z+dz};`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.result)), { neck: 10, dz: 708, top: 908 });
  assert.equal(ctx.result.top - 899, 9, 'обечайка выступает над листом крыши на 9 мм');
});

test('сохранённый конденсатор автоматически пересаживается обечайкой в проём', () => {
  const load = section('async function loadProjectData(data){', 'async function openProject(id){');
  assert.match(load, /roleOf\(p\.d\)!=='cond'\|\|!p\.link\|\|!p\.link\.under/);
  assert.match(load, /const z=p\.obj\.position\.z;reseatLink\(p\)/);
  assert.match(load, /schemaMoved\|\|tankMountMoved\|\|condSeatMoved/);
});
