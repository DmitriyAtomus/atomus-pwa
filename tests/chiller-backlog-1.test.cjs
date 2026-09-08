// Список доработок Дмитрия от 08.09.2026 (v2.46.157): расчёт помнит данные +
// вкладка «Расход через испаритель» + R134A; серии фильтров; третий уровень
// рубрикатора «тип»; насосы Pedrollo с характеристиками.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const idx = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'index.html'), 'utf8');
const prj = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'project.html'), 'utf8');
function load(file) {
  const full = path.join(__dirname, '..', 'chiller', file);
  delete require.cache[require.resolve(full)];      // каждый вызов — свежий window
  const w = {}; global.window = w; require(full); return w;
}

test('1) расчёт: значения полей и вкладка живут в localStorage, есть «Очистить»', () => {
  assert.match(idx, /CALC_VALS_KEY = 'chiller\.calcVals'/);
  assert.match(idx, /function calcCapture\(\)/);
  assert.match(idx, /function calcApplyVals\(\)/);
  assert.match(idx, /function calcClear\(\)/);
  assert.match(idx, /onclick="calcClear\(\)"[^>]*>⟲ Очистить/);
  assert.match(idx, /CALC_VALS\._tab/);
  // переходы между вкладками кладут число в память, а не в DOM после перерисовки
  assert.match(idx, /function calcToComp\(q\) \{ CALC_VALS\.kQ = String\(q\)/);
});

test('2) вкладка «Расход через испаритель»: формула и переходы в насос и трубы', () => {
  assert.match(idx, /data-t="flow">Расход через испаритель/);
  assert.match(idx, /function calcFlow\(\)/);
  assert.match(idx, /const g = Q \* 3600 \/ \(h\[2\] \* h\[1\] \* dt\) \* 1000;\s+\/\/ м³\/ч\n  return \{ Q: Q, h: h, hcIdx/);
  assert.match(idx, /function calcFlowToPump\(\)/);
  assert.match(idx, /function calcFlowToPipe\(\)/);
  assert.match(idx, /calcSave\(\{ flow: \{/);
  // насос предупреждает, если условия разошлись с расходом
  assert.match(idx, /На вкладке «Расход через испаритель» посчитано/);
});

test('6) хладагент R134A вместо опечатки 132A', () => {
  assert.match(idx, /'134А': \[\[-50,136,1\.654,367\.3,1442\.547\]/);
  assert.doesNotMatch(idx, /'132А'/);
});

test('4) типы: классификатор раскладывает реальные позиции по типам', () => {
  const w = load('atypes.js'); const A = w.ATYPES;
  const of = (section, name) => A.of({ section, name });
  assert.equal(of('valves', 'GBC 12s 009L7022R Запорный шаровой кран, DN12'), 'gbc');
  assert.equal(of('valves', '014L0183R SGP 12S N Стекло смотровое,1/2"'), 'sight');
  assert.equal(of('valves', '023B7014R DFL 084s Фильтр-осушитель 1/2"'), 'filt');
  assert.equal(of('valves', '020-1018R NRV 16S Клапан обратный прямоточный'), 'nrv');
  assert.equal(of('valves', '020В1132 NRD 12 Клапан дифференциальный'), 'reg');
  assert.equal(of('valves', '034L0093R KVR 12 Клапан регулирующий'), 'reg');
  assert.equal(of('valves', '032L1217R EVR 10 NC Клапан соленоидный'), 'sol');
  assert.equal(of('valves', '068Z4209R TE2 TPB R407C/R22'), 'trv');
  assert.equal(of('valves', 'Вентиль Rotalock CS-RV-1-12'), 'svc');
  assert.equal(of('automation', '061F8492R ACB-2UB463W Реле давления картриджное'), 'psw');
  assert.equal(of('automation', 'Манометр с глицерином CS-NG-LRC-80'), 'gauge');
  assert.equal(of('automation', 'Реле потока ДР-П-03-20'), 'flow');
  assert.equal(of('vessels', '159 Ресивер CS-LR - 8,0'), 'recv');
  assert.equal(of('vessels', '114 Отделитель жидкости CS-AS - 2,5-15'), 'sep');
  assert.equal(of('pumps', 'Насос Ридан RMHI 2-2R'), 'rmhi');
  assert.equal(of('pumps', 'Насос Pedrollo 2CP 25/14B'), '2cp');
  assert.equal(of('pumps', 'Насос Pedrollo CPm 158'), 'cp');
  assert.equal(of('compressors', 'Компрессор спиральный YH104T1-210'), 'scroll');
  assert.equal(A.label('valves', 'sight'), 'Смотровые стёкла');
  // узлы листа знают свой тип
  assert.equal(A.NODE.F1, 'filt'); assert.equal(A.NODE.SI1, 'sight'); assert.equal(A.NODE.KO1, 'nrv');
  // типы выборки — с количеством
  const t = A.types([{ section: 'valves', name: 'SGP 12S' }, { section: 'valves', name: 'SGP 10S' }, { section: 'valves', name: 'GBC 12s' }]);
  assert.deepEqual(t.map(x => x.key + ':' + x.n), ['sight:2', 'gbc:1']);
});

test('4) тип — фильтр в витрине, каталоге и конвейере', () => {
  assert.match(idx, /if\(f\.type && ATYPES\.of\(d\)!==f\.type\) return false;/);
  assert.match(idx, /data-t="\$\{t\.key\}"/);
  assert.match(idx, /<script src="atypes\.js"><\/script>/);
  assert.match(prj, /<script src="atypes\.js"><\/script>/);
  assert.match(prj, /if\(S\.type&&ATYPES\.of\(d\)!==S\.type\)return false;/);
  assert.match(prj, /if\(nomSt\.type&&ATYPES\.of\(d\)!==nomSt\.type\)return false;/);
  assert.match(prj, /type:\(cat\.sec&&ty\)\?ty:null/);   // узел открывает свой тип
});

test('3) серии фильтров: раскладка с пояснением и рекомендацией', () => {
  const w = load('atypes.js'); const A = w.ATYPES;
  ['DML', 'DFL', 'DCL', 'DGL', 'DAS', 'DCR'].forEach(sr => assert.ok(A.FILTER_SERIES[sr], 'нет описания ' + sr));
  assert.equal(A.series({ name: '023B7014R DFL 084s Фильтр-осушитель' }), 'DFL');
  assert.equal(A.series({ name: 'DCR 0487s корпус', pick: { ser: 'DCR' } }), 'DCR');
  assert.match(prj, /function asgFilterSeriesHtml\(pool\)/);
  assert.match(prj, /жидкостной DFL \/ DML/);
  assert.match(prj, /только после сгорания компрессора/);
  assert.match(prj, /let h=S\.type==='filt'\?asgFilterSeriesHtml\(pool\):'';/);
});

test('5) насосы Pedrollo: линейка с кривыми Q–H, характеристиками и прорисовкой', () => {
  const w = load('pedrollo.js'); const P = w.PEDROLLO;
  const items = P.items();
  assert.ok(items.length >= 50, 'мало позиций: ' + items.length);
  assert.equal(new Set(items.map(d => d.id)).size, items.length, 'дубли id');
  P.raw.forEach(p => {
    assert.equal(p.q.length, p.h.length, p.m + ': кривая рваная');
    let prev = Infinity;
    p.h.forEach(v => { if (v == null) return; assert.ok(v <= prev + 0.01, p.m + ': напор растёт с подачей'); prev = v; });
    assert.ok(p.kw > 0 && p.dims.length === 3 && p.dn.length === 2, p.m + ': нет данных');
  });
  const cp158 = items.find(d => d.id === 'PED-CP-158');
  assert.ok(cp158);
  assert.equal(cp158.section, 'pumps'); assert.equal(cp158.sub, 'cp');
  assert.match(cp158.tags[0], /^подача до 5,4 м³\/ч$/);
  assert.match(cp158.specs.find(s => s[0] === 'Мощность P2')[1], /^0,75 кВт/);
  assert.ok(Math.abs(P.headAt(P.raw.find(p => p.m === 'CP 158'), 3) - 31.5) < 0.01);
  // подключено и в витрину, и в конструктор
  assert.match(idx, /<script src="pedrollo\.js"><\/script>/);
  assert.match(idx, /window\.PEDROLLO\.items\(\)\.forEach/);
  assert.match(prj, /function pedrolloMerge\(\)/);
  assert.match(prj, /case 'pump':\{/);
  assert.match(prj, /secNames\(\);pedrolloMerge\(\);secNames\(\)/);   // имена подразделов — уже с насосами
});
