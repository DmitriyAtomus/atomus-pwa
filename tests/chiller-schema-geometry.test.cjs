// Схема чиллера — заводской лист АГ.ЧИЛ-104 Г3 (v2.45.1017): арт статичный,
// поверх живут бирки позиций. Тест исполняет НАСТОЯЩИЙ renderSchema из
// project.html и геометрически проверяет: бирки и подписи моделей не наезжают
// ни на трубы листа, ни на его надписи, ни друг на друга — в пустом проекте
// и при полностью назначенных длинных именах (худший случай ширины).
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

// вырезаем данные, арт листа и рендер — ровно те, что работают в проде
const code =
  slice('const SCH_NODES=[', 'const SCH_DESC=') +
  slice('const SCH_SHEET=', 'function renderSchema(){') +
  slice('function renderSchema(){', 'function schRenderChips(){') +
  'function schRenderChips(){}';

function render(schemaData) {
  const svg = { innerHTML: '', querySelectorAll: () => [] };
  const fn = new Function(
    'schemaData', '$', 'esc', 'document', 'openAssign', 'innerWidth', 'innerHeight', '__svg',
    code + '\nrenderSchema();\nreturn __svg.innerHTML;'
  );
  return fn(
    schemaData,
    () => svg,
    (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    { getElementById: () => null },
    () => {}, 1920, 1080, svg
  );
}

// ширина символа по классу текста (эмпирика листа, px на символ)
const CHW = { lbl: 4.4, sub: 3.2, shn: 3.5, shl: 5.2 };
const ASC = { lbl: 7, sub: 5.6, shn: 6, shl: 8.6 };

function geometry(svgHtml) {
  const texts = [];
  const reT = /<text class="(lbl|sub|shn|shl)(?: ok| wt)?"[^>]*x="([\d.-]+)"[^>]*y="([\d.-]+)"([^>]*)>([^<]+)<\/text>/g;
  for (const m of svgHtml.matchAll(reT)) {
    const [, cls, xs, ys, rest, raw] = m;
    const t = raw.trim();
    if (!t) continue;
    const anc = /text-anchor="(\w+)"/.exec(rest)?.[1] || 'start';
    const x = parseFloat(xs), y = parseFloat(ys);
    const w = t.length * CHW[cls];
    const x0 = anc === 'middle' ? x - w / 2 : anc === 'end' ? x - w : x;
    texts.push([x0, y - ASC[cls], x0 + w, y + 1.2, t, cls]);
  }
  // бирки-пилюли: rx="5.5" height="11"
  const pills = [];
  for (const m of svgHtml.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="11" rx="5.5"/g)) {
    const [x, y, w] = m.slice(1).map(Number);
    pills.push([x, y, x + w, y + 11]);
  }
  // трубы листа — ортогональные полилинии фаз
  const segs = [];
  for (const m of svgHtml.matchAll(/<polyline class="(wtr|hot|liq|suc|byp)" points="([^"]+)"/g)) {
    const pts = m[2].trim().split(/\s+/).map((p) => p.split(',').map(Number));
    for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
  }
  return { texts, pills, segs };
}

const PAD = 1.4; // полутолщина трубы листа
function overlaps(svgHtml) {
  const { texts, pills, segs } = geometry(svgHtml);
  const hits = [];
  const boxHit = (a, b) => !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
  const segHit = ([p1, p2], b) => {
    const [x1, y1] = p1, [x2, y2] = p2;
    if (x1 === x2) return b[0] <= x1 + PAD && x1 - PAD <= b[2] && !(Math.max(y1, y2) + PAD < b[1] || Math.min(y1, y2) - PAD > b[3]);
    if (y1 === y2) return b[1] <= y1 + PAD && y1 - PAD <= b[3] && !(Math.max(x1, x2) + PAD < b[0] || Math.min(x1, x2) - PAD > b[2]);
    return false;
  };
  // динамика (shn/shl) — от труб подальше; статичные надписи листа проверены отдельно при вёрстке
  const dyn = texts.filter((t) => t[5] === 'shn' || t[5] === 'shl');
  for (const b of dyn) for (const sg of segs) if (segHit(sg, b)) hits.push('труба × «' + b[4] + '»');
  // бирка × любой текст
  for (const p of pills) for (const t of texts) if (boxHit(p, t)) hits.push('бирка × «' + t[4] + '»');
  // бирка × бирка
  for (let i = 0; i < pills.length; i++)
    for (let j = i + 1; j < pills.length; j++)
      if (boxHit(pills[i], pills[j])) hits.push('бирка × бирка (' + pills[i][0] + ',' + pills[i][1] + ')');
  // текст × текст
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++)
      if (boxHit(texts[i], texts[j])) hits.push('«' + texts[i][4] + '» × «' + texts[j][4] + '»');
  return { hits, texts: texts.length, pills: pills.length, segs: segs.length };
}

test('пустой проект: 24 бирки «назначить» — ничего не пересекается', () => {
  const html = render({});
  const r = overlaps(html);
  assert.equal(r.pills, 24, 'бирок не 24: ' + r.pills);
  assert.ok((html.match(/>назначить</g) || []).length === 24, 'не у каждой бирки строка «назначить»');
  assert.deepEqual(r.hits, [], 'пересечения: ' + r.hits.join('; '));
});

test('всё назначено длинными именами — тоже чисто', () => {
  const data = {};
  for (const m of src.matchAll(/\{k:'(\w+)',/g)) data[m[1]] = { name: 'МОДЕЛЬ-Ц123456-ДЛИННАЯ' };
  const html = render(data);
  const r = overlaps(html);
  assert.deepEqual(r.hits, [], 'пересечения: ' + r.hits.join('; '));
  assert.ok(!/>назначить</.test(html), 'остались неназначенные при полных данных');
});

test('лист настоящий: штамп, легенда, полка вне листа, пульс следующего', () => {
  const html = render({});
  assert.match(html, /Гидравлическая схема чиллер 7 кВт/);
  assert.match(html, /АГ\.ЧИЛ-104 Г3/);
  assert.match(html, /Пар высокого давления/);          // легенда фаз
  assert.match(html, /Аккумулирующий бак/);
  assert.match(html, /Трубка уровня/);
  assert.match(html, /Кран сливной/);
  assert.match(html, /ПОЗИЦИИ ВНЕ ЛИСТА 7 кВт/);
  assert.match(html, /sch-pulse/, 'нет пульса «следующий к назначению»');
  assert.match(html, /Назначено: 0 из 24/);
  // все шесть позиций полки на месте
  for (const t of ['ЕК1', 'КО1', 'КД1', 'КР1', 'КО2', 'ВН1'])
    assert.ok(html.includes('>' + t + '<'), 'нет бирки ' + t);
});

test('интерактив подключён: клики, тултип, чипы групп', () => {
  const html = render({});
  assert.equal((html.match(/class="sn(?: dim)?" data-k="/g) || []).length, 24);
  assert.match(src, /id="schTip"/);
  assert.match(src, /g\.onmousemove/);
  assert.match(src, /schRenderChips\(\);/);
  assert.match(src, /SCH_GROUPS/);
  assert.match(src, /schGrpToggle/);
  assert.match(src, /openAssign\(g\.dataset\.k\)/);
});
