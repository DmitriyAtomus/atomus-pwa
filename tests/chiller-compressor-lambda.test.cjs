// Объёмная производительность компрессора: λ применяется делением.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const idx = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'index.html'), 'utf8');
const project = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'project.html'), 'utf8');

function section(from, to) {
  const a = idx.indexOf(from), b = idx.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `не найден блок ${from}`);
  return idx.slice(a, b);
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  section('const KCOMP =', '/* Сортамент медной трубы') +
  'globalThis.C={KCOMP};', ctx
);
const K = ctx.C.KCOMP;

test('коэффициенты λ соответствуют типам компрессоров', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(K)), {
    'спиральный': 0.95,
    'поршневой': 0.85,
    'винтовой': 0.9,
  });
});

test('потребный объём получается делением на λ', () => {
  const theoretical = 10;
  const volumes = Object.fromEntries(
    Object.entries(K).map(([type, lambda]) => [type, theoretical / lambda])
  );
  assert.ok(volumes['поршневой'] > volumes['винтовой']);
  assert.ok(volumes['винтовой'] > volumes['спиральный']);

  const calc = section('function calcCompPaint()', '/* ── 3. Диаметры');
  assert.match(calc, /const theoreticalVol = mass \/ rhoV;/);
  assert.match(calc, /const vol = theoreticalVol \/ k;/);
  assert.doesNotMatch(calc, /const vol\s*=.*\*\s*k/);
});

test('расшифровка показывает λ и деление, старого предупреждения нет', () => {
  const calc = section('function calcCompPaint()', '/* ── 3. Диаметры');
  assert.match(calc, /объёмный коэффициент «\$\{type\}»: <i>λ =/);
  assert.match(calc, /потребный объём:.*÷/s);
  assert.doesNotMatch(calc, /Проверьте, что это именно ваш коэффициент запаса/);
  assert.doesNotMatch(calc, /type !== 'спиральный'/);
});

test('новое значение сохраняется в comp.vol и читается проектом в двух местах', () => {
  assert.match(idx, /calcSave\(\{ comp: \{ Q: Q, ref: ref, t0: t0, tk: tk, type: type, vol: vol \} \}\)/);
  assert.equal((project.match(/C\.comp\.vol/g) || []).length, 2);
  assert.match(project, /объёмная производительность компрессора.*C\.comp\.vol/s);
  assert.match(project, /<span>Компрессор<\/span><b>'\+schFx\(C\.comp\.vol,2\)/);
});
