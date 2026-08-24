// Ручной конструктор трассы: видимая ручка длины, отвод на свободный конец,
// четыре стороны поворота и продолжение трубой. Одинаково для меди и PP-R.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const page = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'project.html'), 'utf8');

function section(from, to) {
  const a = page.indexOf(from), b = page.indexOf(to, a);
  assert.notEqual(a, -1, 'не нашёл начало блока: ' + from);
  assert.notEqual(b, -1, 'не нашёл конец блока: ' + to);
  return page.slice(a, b);
}

function stand() {
  const ctx = {
    placed: [],
    zoneAt: (it, i) => it.zn[i],
    connOf: z => z && z.c,
    isPipeSeg: it => !!it.pipe,
    elbowPair: z => z.length >= 2 ? { i: 0, j: 1 } : null,
  };
  vm.createContext(ctx);
  vm.runInContext(section('function routeTurn90(d){', 'function routeWorldEnd(it,q){'), ctx);
  ctx.routePlain = vm.runInContext('(d)=>routePlainElbow(d)', ctx);
  return ctx;
}

const zone = name => ({ name, p0: [0, 0, 0], dir: [1, 0, 0],
  c: { t: 'ppr', size: 40, sex: 'm', txt: 'сварка PP-R Ø40' } });

test('у выбранной трассы есть отдельная панель и крупная ручка на торце', () => {
  assert.match(page, /<div id="routebar"><\/div>/);
  assert.match(page, /<div id="routeGrip"><i>↔<\/i><b><\/b><\/div>/);
  assert.match(page, /Зажми круглую ручку на торце и тяни вдоль трубы/);
  assert.match(page, /tagReset\(\);portsSync\(\);rotSync\(\);routeSync\(\);/);
  assert.match(page, /portsRebuild\(\);routeRebuild\(\);/);
});

test('дальний торец трубы находится напротив посадочного и помнит занятую деталь', () => {
  const S = stand();
  const pipe = { uid: 1, pipe: true, d: { section: 'pipe', name: 'Труба PP-R' },
    zn: [zone('вход'), zone('выход')], link: { mount: 'rot', pzi: 0 } };
  S.placed.push(pipe);
  let q = S.routeEnd(pipe);
  assert.equal(q.zi, 1);
  assert.equal(q.taken, false);

  const elbow = { uid: 2, d: { section: 'pipe', name: 'Угольник 90°' },
    zn: [zone('вход'), zone('выход')], link: { mount: 'rot', to: 1, zi: 1, pzi: 0 } };
  S.placed.push(elbow);
  q = S.routeEnd(pipe);
  assert.equal(q.taken, true);
  assert.equal(q.child.uid, 2);
});

test('для кнопки отвода остаются только поворотные 90°, не 45° и не переходы', () => {
  const S = stand();
  assert.equal(S.routeTurn90({ section: 'pipe', name: 'Отвод медный 90°' }), true);
  assert.equal(S.routeTurn90({ section: 'pipe', name: 'Угольник PP-R 90°' }), true);
  assert.equal(S.routeTurn90({ section: 'pipe', name: 'Отвод медный 45°' }), false);
  assert.equal(S.routeTurn90({ section: 'pipe', name: 'Угольник с переходом на резьбу' }), true);
  assert.equal(S.routePlain({ section: 'pipe', name: 'Угольник с переходом на резьбу' }), false);
});

test('ручное растягивание пишет один шаг истории, снимает авто-длину и двигает цепочку', () => {
  const drag = section('(function routeGripBind(){', '/* ═══ автопротяжка трубы');
  assert.match(drag, /setPointerCapture\(e\.pointerId\)/);
  assert.match(drag, /pushHistRaw\(\{s:drag\.snap,t:'ручное изменение длины трубы'\}\)/);
  assert.match(drag, /drag\.it\.fit=null;setPipeLen\(drag\.it,L\)/);
  assert.match(drag, /checkCollisions\(\);showSelZ\(\);refresh\(\);save\(\)/);
});

test('конструктор предлагает отвод, четыре стороны и продолжение трубой', () => {
  const b = section('function routeRollButtons(it,q){', '(function routeGripBind(){');
  assert.match(b, /\[0,90,180,270\]/);
  assert.match(page, /face>0\?'⊙':'⊗'/);
  assert.match(b, /data-rb="elbow">↳ Поставить отвод 90°/);
  assert.match(b, /data-rb="tube">＋ Продолжить трубой/);
  assert.match(b, /rotPick\(sel,q\.zi,x,y,null,\{kind:kind,manual:true\}\)/);
  assert.match(page, /if\(opt&&opt\.kind==='elbow'\)list=list\.filter\(m=>routePlainElbow\(m\.d\)\)/);
  assert.match(page, /if\(opt&&opt\.kind==='tube'\)list=list\.filter/);
});
