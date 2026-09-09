// Диаметр и потери контура хладоносителя: PP-R / ВГП, Darcy–Weisbach и
// перенос рабочей точки между вкладками расчёта.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const idx = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'index.html'), 'utf8');
function section(from, to) {
  const a = idx.indexOf(from), b = idx.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `не найден блок ${from}`);
  return idx.slice(a, b);
}

const ctx = { Math };
vm.createContext(ctx);
vm.runInContext(
  section('const HC = [', '/* свойства хладагентов') +
  section('const TUBES = [', '/* ═══ v2.46.157: расчёт помнит') +
  section('function calcPipeHydraulic(', 'function calcPipePaint()') +
  'globalThis.P={HC,PPR_TUBES,VGP_TUBES,PIPE_MATERIALS,tubeIn,calcPipeHydraulic};', ctx
);
const P = ctx.P;

test('у всех 14 жидкостей есть положительная кинематическая вязкость', () => {
  assert.equal(P.HC.length, 14);
  P.HC.forEach(h => {
    assert.equal(h.length, 4, h[0]);
    assert.ok(h[1] > 0 && h[2] > 0 && h[3] > 0, h[0]);
  });
});

test('форма содержит все поля гидравлического контура', () => {
  ['pHc', 'pDt', 'pMat', 'pSeries', 'pWh', 'pDistance', 'pLength', 'pLocal']
    .forEach(id => assert.match(idx, new RegExp(`id="${id}"`)));
  assert.match(idx, /value="1\.5"[^>]*>[\s\S]*норма 1,0…2,0/);
  assert.match(idx, /value="25" step="5" min="0"/);
  assert.match(idx, /function calcPipeLengthAuto\(\)/);
  assert.match(idx, /pLengthManual/);
});

test('PP-R имеет четыре разных ряда, ВГП — три исполнения ГОСТ 3262-75', () => {
  assert.deepEqual(Object.keys(P.PPR_TUBES), ['PN10', 'PN16', 'PN20', 'PN25']);
  assert.deepEqual(Object.keys(P.VGP_TUBES), ['light', 'standard', 'reinforced']);
  const walls = Object.values(P.PPR_TUBES).map(rows => rows.find(t => t[0] === 32)[2]);
  assert.deepEqual(walls, [2.9, 4.4, 5.4, 6.5]);
  assert.ok(new Set(walls).size === 4);
  const dn25 = Object.values(P.VGP_TUBES).map(rows => rows.find(t => t[1] === 'DN 25'));
  assert.deepEqual(dn25.map(t => [t[0], t[2]]), [[33.5, 2.8], [33.5, 3.2], [33.5, 4]]);
});

test('гидравлика считает проход, скорость, Re, λ и потери на полный контур', () => {
  const water = P.HC[0];
  const ppr = P.calcPipeHydraulic(100, water, 5, 1.5,
    P.PPR_TUBES.PN20, P.PIPE_MATERIALS.ppr.roughness, 40, 25);
  assert.ok(ppr.flow > 17 && ppr.flow < 18);
  assert.ok(ppr.need > 60 && ppr.need < 70);
  assert.ok(ppr.speed >= 1 && ppr.speed <= 2);
  assert.ok(ppr.re > 2300 && ppr.lambda > 0);
  assert.ok(ppr.paM > 0 && ppr.kpa > 0 && ppr.head > 0);
  assert.ok(Math.abs(ppr.pa - ppr.paM * 40 * 1.25) < 1e-8);

  const steel = P.calcPipeHydraulic(100, water, 5, 1.5,
    P.VGP_TUBES.standard, P.PIPE_MATERIALS.steel.roughness, 40, 25);
  assert.equal(steel.zone, 'Альтшуль');
  assert.match(steel.tube[1], /^DN /);
});

test('расход переносит жидкость и Δt в трубы, а расход с напором — в насос', () => {
  assert.match(idx, /CALC_VALS\.pHc = String\(r\.hcIdx\); CALC_VALS\.pDt = String\(r\.dt\)/);
  assert.match(idx, /const head = calcPipeHeadForFlow\(r\); CALC_VALS\.uHead = String/);
  assert.match(idx, /function calcPipeToPump\(Q, hcIdx, dt, head\)/);
  assert.match(idx, /id="uHead"/);
  assert.match(idx, /calcPickPump\(\$\{g\.toFixed\(2\)\},\$\{head\.toFixed\(2\)\}\)/);
  assert.match(idx, /window\.PEDROLLO\.headAt\(d\.ped, f\.need\.value\)/);
});

test('третья tubeRow и блок потерь показывают требуемые единицы', () => {
  assert.match(idx, /tubeRow\('Контур хладоносителя/);
  assert.match(idx, /Потери давления/);
  assert.match(idx, /Па\/м/);
  assert.match(idx, /кПа/);
  assert.match(idx, /м вод\. ст\./);
  assert.match(idx, /Блазиус/);
  assert.match(idx, /Альтшуль/);
});
