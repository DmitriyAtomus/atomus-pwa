// «⚡ Обвязать по схеме» (v2.46.148): рёбра листа АГ.ЧИЛ-104 + автопротяжка
// магистралей той же pullCheck/pullLay, что работает вручную. Рёбра гоняем
// настоящим литералом: каждый конец — существующий узел схемы, фреоновый
// контур замкнут в кольцо КМ1 → … → ОЖ1 → КМ1.
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

function edges() {
  const code = slice('const SCH_EDGES=[', 'const schNodeT');
  return new Function(code + 'return SCH_EDGES;')();
}
function nodeKeys() {
  const nodes = slice('const SCH_NODES=[', 'const SCH_DESC={');
  return (nodes.match(/\{k:'(\w+)'/g) || []).map(m => m.slice(4, -1));
}

test('каждое ребро соединяет два разных существующих узла схемы', () => {
  const E = edges(), K = new Set(nodeKeys());
  assert.ok(E.length >= 10, 'мало рёбер: ' + E.length);
  E.forEach(e => {
    assert.ok(K.has(e.a), 'нет узла ' + e.a);
    assert.ok(K.has(e.b), 'нет узла ' + e.b);
    assert.notEqual(e.a, e.b);
    assert.ok(e.t && e.t.length > 2, 'у ребра нет имени линии');
    assert.ok(e.pa instanceof RegExp && e.pb instanceof RegExp, 'нет regex патрубков');
  });
});

test('фреоновый контур замкнут: КМ1 → конденсатор → … → отделитель → КМ1', () => {
  const E = edges();
  const next = {};
  E.filter(e => e.t !== 'вода').forEach(e => { next[e.a] = e.b; });
  const seen = [];
  let k = 'KM1';
  for (let i = 0; i < 20; i++) {
    seen.push(k);
    k = next[k];
    assert.ok(k, 'контур оборвался после ' + seen[seen.length - 1]);
    if (k === 'KM1') break;
  }
  assert.equal(k, 'KM1', 'контур не вернулся в компрессор: ' + seen.join('→'));
  assert.ok(seen.includes('AVO1') && seen.includes('TRV1') && seen.includes('I1') &&
    seen.includes('OZH1'), 'в контуре нет обязательных узлов: ' + seen.join('→'));
});

test('водяной контур: бак → насос → испаритель → бак', () => {
  const E = edges().filter(e => e.t === 'вода');
  assert.deepEqual(E.map(e => e.a + '>' + e.b), ['AB1>N1', 'N1>I1', 'I1>AB1']);
});

test('обвязка зовёт настоящую протяжку и честно откатывает неудачу', () => {
  const be = slice('async function bindEdge(e,used)', 'async function bindBySchema');
  assert.match(be, /pullCheck\(a,b\)/);
  assert.match(be, /pullLay\(made,a,b,q\.pl,q\.pts,q\.dirs\)/);
  assert.match(be, /madeRemove\(made\)/);           // не легло — детали убраны
  assert.match(be, /used\.add\(A\.uid/);            // патрубок не займётся дважды
  const bz = slice('function bindZone(it,rx,other,used)', 'async function bindEdge');
  assert.match(bz, /sae|SAE/);                      // капилляры — не магистраль
  assert.match(bz, /bindCenter/);                   // геометрия решает спорные патрубки
});

test('кнопка и отчёт на месте', () => {
  assert.match(src, /id="bBind">⚡ Обвязать по схеме/);
  assert.match(src, /\$\('#bBind'\)\.onclick=bindBySchema;/);
  const br = slice('function bindReport(rep)', '/* ═══ v2.46.023');
  assert.match(br, /Обвязка по схеме/);
  assert.match(br, /легло: /);
  assert.match(br, /перестановкой узла/);
});
