// Компоновка проекта (chiller/project.html): на свободный патрубок садится
// ответная часть — не только вентиль на ротолок, как было, а всё, у чего
// присоединение сошлось: фильтр на медную трубку компрессора, полипропилен
// на резьбу насоса, труба PP-R в раструб фитинга. Проверяем разбор
// присоединения, правило пары и подбор по каталогу — на настоящем коде
// страницы, а не на его пересказе.
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

/* живой стенд: код присоединений из страницы + подставной каталог базы */
function stand(items, geoms) {
  const code = section('const CT_NAME=', 'function rotClear()');
  const ctx = {
    DATA: items || [],
    GEOMS: geoms || {},
    placed: [],
    THREE: { Vector3: function () { this.addScaledVector = () => this; } },
    localStorage: { getItem: () => null, setItem: () => {} },
    $: () => null,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

const ZN = {
  compDis: { kind: 'dis', name: 'НАГНЕТАНИЕ', od: 12.7, p0: [0, 0, 330], dir: [1, 0, 0],
             ctype: 'odf', conn: 'Ø12,7 пайка', sex: 'm', seat: 138 },
  compSuc: { kind: 'suc', name: 'ВСАСЫВАНИЕ', od: 22.22, p0: [0, 0, 242], dir: [1, 0, 0],
             ctype: 'odf', conn: 'Ø22,22 пайка', sex: 'm', seat: 138 },
  filter:  { kind: 'suc', name: 'ПАТРУБОК 1/2" ODF', od: 14.8, p0: [0, 0, 0], dir: [-1, 0, 0],
             ctype: 'odf', conn: 'Ø12,7 пайка', sex: 'f', seat: 90 },
  pumpThr: { kind: 'suc', name: 'ВСАСЫВАНИЕ G1 1/4', od: 41.9, p0: [0, 0, 90], dir: [0, -1, 0],
             ctype: 'thr', conn: 'G1 1/4', sex: 'm', seat: 12 },
  pprThr:  { kind: 'suc', name: 'РЕЗЬБА 1-1/4" внутренняя', od: 41.9, p0: [0, 0, 0], dir: [1, 0, 0],
             ctype: 'thr', conn: 'G1-1/4', sex: 'f', seat: 27 },
  pprSock: { kind: 'suc', name: 'ПОД СВАРКУ Ø32', od: 41, p0: [0, 0, 0], dir: [-1, 0, 0],
             ctype: 'ppr', conn: 'Ø32 сварка PP-R', sex: 'f', seat: 26 },
  pprPipe: { kind: 'suc', name: 'ТРУБА Ø32', od: 32, p0: [0, 0, 0], dir: [1, 0, 0],
             ctype: 'ppr', conn: 'Ø32 сварка PP-R', sex: 'm', seat: 250 },
  rotStud: { kind: 'dis', name: 'ВЫХОД ЖИДКОСТИ', od: 25.4, p0: [0, 0, 0], dir: [-1, 0, 0],
             ctype: 'rot', conn: 'ротолок 1"-14 UNS', sex: 'm', seat: 47 },
  rotNut:  { kind: 'dis', name: 'РОТОЛОК 1"-14 UNS', od: 25.4, p0: [0, 0, 0], dir: [-1, 0, 0],
             ctype: 'rot', conn: 'ротолок 1"-14 UNS', sex: 'f', seat: 0 },
  plain:   { kind: 'suc', name: 'ВЫХОД', od: 16, p0: [0, 0, 0], dir: [0, 0, 1] },
};

test('присоединение разбирается на тип, размер и наружную/ответную часть', () => {
  const s = stand();
  assert.equal(JSON.stringify(s.connOf(ZN.compDis)),
    JSON.stringify({ t: 'odf', size: 12.7, sex: 'm', txt: 'пайка Ø12,7' }));
  assert.equal(s.connOf(ZN.pumpThr).t, 'thr');
  assert.equal(s.connOf(ZN.pumpThr).txt, 'резьба G1 1/4');
  assert.equal(s.connOf(ZN.pprSock).txt, 'сварка PP-R Ø32');
  // зона без разметки присоединения ответной части не просит
  assert.equal(s.connOf(ZN.plain), null);
});

test('пара сходится по типу и размеру, а труба в трубу не садится', () => {
  const s = stand();
  const c = z => s.connOf(z);
  assert.ok(s.connFit(c(ZN.compDis), c(ZN.filter)), 'Ø12,7 компрессора — в раструб 1/2" ODF');
  assert.ok(!s.connFit(c(ZN.compSuc), c(ZN.filter)), 'Ø22,22 в раструб 1/2" не лезет');
  assert.ok(!s.connFit(c(ZN.compDis), c(ZN.compSuc)), 'две трубки друг в друга не садятся');
  assert.ok(s.connFit(c(ZN.rotStud), c(ZN.rotNut)), 'ротолок остался как был');
  // «G1 1/4» у насоса и «G1-1/4» у фитинга — одна и та же резьба
  assert.ok(s.connFit(c(ZN.pumpThr), c(ZN.pprThr)));
  assert.ok(s.connFit(c(ZN.pprPipe), c(ZN.pprSock)), 'труба PP-R — в раструб фитинга');
  assert.ok(!s.connFit(c(ZN.pprPipe), c(ZN.pprThr)), 'сварка и резьба — разные присоединения');
});

test('в списке — только подходящее, а в раструб предлагаются трубы', () => {
  const items = [
    { id: 'F1', name: 'DML 305S', section: 'valves', ready: true, g: 'f1' },
    { id: 'F2', name: 'DML 307S', section: 'valves', ready: true, g: 'f2' },
    { id: 'P1', name: 'труба PP-R Ø32', section: 'pipe', ready: true, g: 'p1' },
    { id: 'T1', name: 'угольник 32', section: 'pipe', ready: true, g: 't1' },
    { id: 'X1', name: 'в очереди', section: 'valves', ready: false, g: 'f1' },
  ];
  const geoms = {
    f1: { zn: [ZN.filter] },
    f2: { zn: [ZN.filter] },
    p1: { zn: [ZN.pprPipe, ZN.pprPipe] },
    t1: { zn: [ZN.pprSock, ZN.pprSock] },
  };
  const s = stand(items, geoms);
  const ids = z => s.mates(s.connOf(z)).map(m => m.d.id).join(',');
  assert.equal(ids(ZN.compDis), 'F1,F2', 'два фильтра под Ø12,7, позиция без модели не в счёт');
  assert.equal(ids(ZN.compSuc), '', 'под Ø22,22 в этой базе нечего');
  // раструб зовёт трубу, а не аппарат: иначе список выворачивается наизнанку
  assert.equal(ids(ZN.pprSock), 'P1');
  assert.equal(ids(ZN.pprPipe), 'T1');
});

test('свободный патрубок — тот, что ещё не занят и не держит саму деталь', () => {
  const items = [{ id: 'F1', name: 'DML 305S', section: 'valves', ready: true, g: 'f1' }];
  const s = stand(items, { f1: { zn: [ZN.filter] } });
  const host = { uid: 1, zn: [ZN.compDis, ZN.compSuc], link: null };
  const part = { uid: 2, zn: [ZN.filter], link: { to: 1, mount: 'rot', zi: 0, pzi: 0 } };
  s.placed.push(host, part);
  const free = () => s.rotFree().map(f => f.it.uid + ':' + f.zi).join(',');
  // патрубок Ø12,7 занят фильтром, Ø22,22 нечем закрыть, раструб фильтра
  // держит его самого — свободных не остаётся
  assert.equal(free(), '');
  part.link = null;
  assert.equal(free(), '1:0',
    'сняли фильтр — патрубок компрессора снова зовёт ответную часть');
});

test('деталь на патрубке сидит своей зоной, у старых проектов — первым ротолоком', () => {
  const s = stand();
  const v = { zn: [ZN.rotNut, ZN.pprSock], link: { to: 1, mount: 'rot', zi: 0, pzi: 1 } };
  assert.equal(s.mateZoneOf(v).name, 'ПОД СВАРКУ Ø32', 'номер зоны из связи');
  v.link.pzi = null;                       // проект, сохранённый до v2.46.002
  assert.equal(s.mateZoneOf(v).name, 'РОТОЛОК 1"-14 UNS');
});

test('посадка и связь: номер зоны ответной части едет в проект и обратно', () => {
  assert.match(page, /it\.link=\{to:host\.uid,mount:'rot',face:'port',zi:zi,pzi:\(pzi==null\?null:pzi\)\}/);
  assert.match(page, /zi:p\.link\.zi,pzi:p\.link\.pzi,/);          // projPayload
  assert.match(page, /pzi:p\.link\.pzi,roll:p\.link\.roll\}/);     // и при открытии проекта
  assert.match(page, /const z=\(host\.zn\|\|\[\]\)\[v\.link\.zi\],vz=mateZoneOf\(v\)/);
});

test('выделение больше не гасит цвет патрубков', () => {
  const tint = section('function applyTint(p)', 'function checkOutside()');
  assert.match(tint, /const keepPorts=p\.zm&&PORTS&&sel===p/);
  assert.match(tint, /if\(keepPorts&&i>0\)\{m\.emissive\.setHex\(0x000000\)/);
  // упор в корпус и выход за габарит по-прежнему красят деталь целиком
  assert.match(tint, /!collSet\.has\(p\.uid\)&&\s*!hitSet\.has\(p\.uid\)&&!outSet\.has\(p\.uid\)/);
  assert.match(page, /function portsOn\(\)\{portsPaint\(\);placed\.forEach\(applyTint\);portsRebuild\(\);\}/);
});
