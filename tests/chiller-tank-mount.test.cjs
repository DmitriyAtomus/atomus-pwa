const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'project.html'), 'utf8');
const start = html.indexOf('const SH_T=3;');
const end = html.indexOf('function tankShelfPlan', start);
assert.ok(start > 0 && end > start, 'блок крепления бака найден');

const api = new Function(
  html.slice(start, end) + '\nreturn {tankBracketRows,shelfCutOf};'
)();

const box = (x0, x1, y0, y1) => ({
  min: { x: x0, y: y0 },
  max: { x: x1, y: y1 },
});
const P0 = { nm: '00.000.002 Стойка', des: '', b: box(-447, -372, -300, -225) };
const P1 = { nm: '00.000.002 Стойка', des: '', b: box(372, 447, -300, -225) };

test('штатный корпус использует только одинаковые задние стойки', () => {
  const rows = api.tankBracketRows({
    d: { id: 'user:frame', name: 'AG-41.000.000СБ Корпус чиллера' },
  }, P0, P1);
  assert.deepEqual(rows, {
    support: 250, low: 283, top: 663, lowMark: 250, topMark: 630,
  });
  assert.deepEqual(api.tankBracketRows({ d: { id: 'chiller-600x900' } },
    { nm: 'AG-41.000.001 Стойка' }, P1), { unsupported: true });
  assert.equal(api.tankBracketRows({ d: { id: 'custom-frame' } },
    { nm: 'custom post' }, { nm: 'custom post' }), null);
});

test('узел состоит из двух рамных кронштейнов, диагоналей и верхней стяжки', () => {
  const cut = api.shelfCutOf({
    a: 'x', w: 'y', P0, P1, face: -372, dir: 1,
    cw: -3, ca: -265, fw: 525, fa: 200, off: 0,
    z: 250, zTop: 663, zBolt: 283,
  });
  assert.equal(cut.pl.length, 2, 'две нижние опоры');
  assert.equal(cut.lg.length, 2, 'две вертикальные полосы');
  assert.equal(cut.bk.length, 2, 'две ответные пластины');
  assert.equal(cut.dg.length, 2, 'две диагонали');
  assert.equal(cut.st.length, 3, 'П-образная стяжка: поперечина и два уха');
  assert.equal(cut.pd.length, 2, 'EPDM под обеими опорами');
  assert.equal(cut.bo.length, 4, 'по два штатных болта на стойку');
  assert.deepEqual([...new Set(cut.bo.map(p => p[2]))], [283, 663]);
});

test('команда и спецификация называют изготовляемый узел полностью', () => {
  assert.match(html, /▤ Закрепить бак/);
  assert.match(html, /Рамные кронштейны[\s\S]{0,120}отм\. 250\/630/);
  assert.match(html, /Кронштейн рамный бака, лист/);
  assert.match(html, /Стяжка бака П-образная 30×2/);
  assert.match(html, /Пластина ответная 40×400×3/);
  assert.match(html, /Комплект прокладок EPDM 3 мм/);
  assert.match(html, /Болт М6×35, 2 шайбы, гайка самоконтрящаяся/);
});
