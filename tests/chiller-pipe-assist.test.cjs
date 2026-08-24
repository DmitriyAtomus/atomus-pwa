// Ручные данные патрубков и выбор каталожного отвода в автопротяжке.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'chiller', 'project.html'), 'utf8');
const THREE = require(path.join(root, 'chiller', 'three.min.js'));
const base = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'chiller-pipe-pull.fixture.json'), 'utf8'));

function section(from, to) {
  const a = page.indexOf(from), b = page.indexOf(to, a);
  assert.notEqual(a, -1, 'не нашёл начало: ' + from);
  assert.notEqual(b, -1, 'не нашёл конец: ' + to);
  return page.slice(a, b);
}

function stand(items, geoms) {
  const code = section('const CT_NAME=', 'function rotClear()') +
               section('const PULL_TOL=', 'async function pullPut(');
  const ctx = {
    THREE, DATA: items || base.items, GEOMS: geoms || base.geoms,
    placed: [], localStorage: { getItem: () => null, setItem() {} }, $: () => null,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

test('override присоединения живёт на экземпляре и не меняет заводскую зону', () => {
  const S = stand();
  const factory = () => ({ uid: Math.random(), zn: [{
    name: 'ВЫХОД', p0: [0, 0, 0], dir: [1, 0, 0], od: 25, tip: [1, 0, 0],
  }] });
  const a = factory(), b = factory();
  a.po = { 0: { ctype: 'ppr', conn: '25', sex: 'm', dir: [0, 0, -1] } };

  const za = S.zoneAt(a, 0), zb = S.zoneAt(b, 0);
  assert.equal(S.connOf(za).txt, 'сварка PP-R Ø25');
  assert.deepEqual(Array.from(za.dir), [0, 0, -1]);
  assert.equal(S.connOf(zb), null);
  assert.equal(a.zn[0].ctype, undefined, 'общая заводская зона не мутировала');
});

test('ручной выбор артикула отвода имеет приоритет над первым в каталоге', () => {
  const source = base.items.find(d => d.id === 'VTp.751.0.025');
  const alt = Object.assign({}, source, { id: 'ALT-ELBOW-25', name: 'Угольник 90° усиленный Ø25' });
  const S = stand(base.items.concat([alt]), base.geoms);
  const pipe = base.items.find(d => d.id === 'VTp.700.0.025');
  const c = S.connOf(base.geoms[pipe.g].zn[0]);
  const all = S.pullElbows(c);
  assert.ok(all.good.length >= 2);
  assert.equal(S.pullElbow(c, 'ALT-ELBOW-25').d.id, 'ALT-ELBOW-25');
  const host = S.connOf(base.geoms[source.g].zn[S.elbowPair(base.geoms[source.g].zn).i]);
  assert.equal(S.pullPlan({ c: host, z: { name: 'A' } }, { c: host, z: { name: 'B' } }, 1,
    { elbow: 'ALT-ELBOW-25' }).el.d.id, 'ALT-ELBOW-25');
});

test('несовместимый выбранный отвод возвращает точную причину', () => {
  const S = stand();
  const z25 = base.geoms[base.items.find(d => d.id === 'VTp.751.0.025').g].zn;
  const c25 = S.connOf(z25[S.elbowPair(z25).i]);
  const pl = S.pullPlan({ c: c25, z: { name: 'A' } }, { c: c25, z: { name: 'B' } }, 1,
    { elbow: 'VTp.751.0.020' });
  assert.match(pl.err, /выбранный отвод.*не подходит.*другой размер/);
});

test('диалог не использует prompt и override входит в проект, загрузку и историю', () => {
  const block = section('const PA_TYPES=', '/* зоны позиции в том же виде');
  assert.match(page, /id="pas"/);
  assert.match(block, /<label>Тип<\/label>/);
  assert.match(block, /<label>Размер<\/label>/);
  assert.match(block, /<label>Сторона<\/label>/);
  assert.match(block, /<label>Направление от детали<\/label>/);
  assert.doesNotMatch(block, /prompt\s*\(/);
  assert.match(page, /po:p\.po&&Object\.keys\(p\.po\)\.length/);
  assert.match(page, /state:\{pin:s\.pin,off:s\.off,link:s\.link,pl:s\.pl,sch:s\.sch,fit:s\.fit,po:s\.po\}/);
  assert.match(page, /p\.po=it\.po\?JSON\.parse\(JSON\.stringify\(it\.po\)\):null/);
  assert.match(page, /histBegin\('уточнение параметров патрубков'\)/);
});

test('PP-R трасса открывает комплект до построения и выбранный отвод идёт во все углы', () => {
  const block = section('const paPart=', 'function pullStart(it,zi)');
  assert.match(block, /Комплект трассы PP-R/);
  assert.match(block, /будет установлен во все/);
  assert.match(block, /elbow:\$\('#pasEl'\)\.value/);
  assert.match(block, /pullRouteAssist\(a,b,q\);return/);
  // Укладка использует один pl.el для каждого угла цикла.
  assert.match(page, /if\(i<dirs\.length-1\)\{[\s\S]*?pullPut\(made,pl\.el\.d/);
});
