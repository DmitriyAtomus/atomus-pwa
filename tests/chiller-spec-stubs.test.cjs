// Нет модели в базе — машина всё равно собирается (v2.46.153): аналог из
// категории, а без него заглушка-габарит с патрубками из строки спецификации.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const src = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'project.html'), 'utf8');
function slice(from, to) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, 'не найдено: ' + from);
  const j = src.indexOf(to, i);
  assert.ok(j > i, 'не найден конец: ' + to);
  return src.slice(i, j);
}
function sandbox() {
  const normSrc = slice('const specNorm=', 'function specTokens');
  const inch = slice('function inchMm(t){', 'function rotFree');
  const stubs = slice('const STUB_DIMS={', 'function stubId(P)');
  return new Function(normSrc + inch + stubs + 'return {STUB_DIMS, stubConnFrom, stubPorts};')();
}

test('у каждого узла листа есть типовой габарит для заглушки', () => {
  const { STUB_DIMS } = sandbox();
  const nodes = slice('const SCH_NODES=[', 'const SCH_DESC={');
  const keys = (nodes.match(/\{k:'(\w+)'/g) || []).map(m => m.slice(4, -1));
  keys.forEach(k => {
    assert.ok(STUB_DIMS[k], 'нет габарита для узла ' + k);
    assert.equal(STUB_DIMS[k].d.length, 3);
  });
});

test('размер присоединения читается из строки спецификации', () => {
  const { stubConnFrom } = sandbox();
  assert.deepEqual(stubConnFrom('023B7014R DFL 084s Фильтр-осушитель 1/2"', '5/8'), { ctype: 'odf', size: 12.7 });
  assert.deepEqual(stubConnFrom('NRV 16S Клапан обратный, 5/8"/16 мм', '1/2'), { ctype: 'odf', size: 15.9 });
  assert.deepEqual(stubConnFrom('Компрессор спиральный YH104T1-210', '5/8'), { ctype: 'odf', size: 15.9 });
  assert.deepEqual(stubConnFrom('Насос', 'G1'), { ctype: 'thr', size: 'G1' });
});

test('заглушка компрессора: патрубки нагнетания и всаса с осями наружу', () => {
  const { stubPorts } = sandbox();
  const z = stubPorts('KM1', 'Компрессор спиральный YH104T1-210');
  assert.equal(z.length, 2);
  assert.equal(z[0].name, 'НАГНЕТАНИЕ'); assert.deepEqual(z[0].dir, [1, 0, 0]); assert.equal(z[0].p0[0], 150);
  assert.equal(z[0].ctype, 'odf'); assert.equal(z[0].sex, 'f'); assert.equal(z[0].conn, '15.9');
  assert.equal(z[1].name, 'ВСАСЫВАНИЕ'); assert.equal(z[1].conn, '19');
  const w = stubPorts('N1', 'Насос Ридан RMHI 2-2R, G1-G1');
  assert.equal(w[0].ctype, 'thr'); assert.equal(w[0].conn, 'G1'); assert.equal(w[0].sex, 'm');
});

test('заглушка живёт в проекте как бак: st в payload и при загрузке', () => {
  assert.match(src, /st:p\.d\.st\|\|undefined/);
  assert.match(src, /s\.st\?stubEnsure\(s\.st\)/);
  assert.match(src, /if\(d\.st\)return stGeoOf\(d\);/);
});

test('разбор спецификации: нет модели → аналог → заглушка, и всё назначается', () => {
  const run = slice('function specRun()', 'async function specAssign');
  assert.match(run, /specAnalog\(r\.name,r\.key\)/);
  assert.match(run, /stubEnsure\(\{key:r\.key,want:r\.name\}\)/);
  assert.match(run, /аналог: /);
  assert.match(run, /заглушка-габарит/);
  const asg = slice('async function specAssign', 'if(typeof document');
  assert.match(asg, /e\.analog=true;e\.want=r\.name/);
  assert.match(asg, /e\.stub=true/);
  // стенд и поиск моделей заглушки не берут
  assert.match(slice('function stressCandidates()', 'function stressBar'), /!d\.st/);
  assert.match(slice('function specFindModel(name,key)', 'let SPEC_LAST'), /!d\.st/);
});
