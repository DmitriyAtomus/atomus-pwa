// Схема чиллера v3: подписи не пересекаются ни с линиями, ни с символами,
// ни друг с другом. Тест исполняет НАСТОЯЩИЙ renderSchema из project.html
// и геометрически проверяет результат — в пустом проекте и в полностью
// назначенном длинными именами моделей (худший случай ширины подписей).
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

// вырезаем данные, глиф и рендер — ровно те, что работают в проде
const code =
  slice('const SCH_NODES=[', 'function _g(kind,x,y){') +
  slice('function _g(kind,x,y){', 'function renderSchema(){') +
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

function overlaps(svgHtml) {
  const texts = [];
  for (const m of svgHtml.matchAll(/<text class="(st|sa|su)"[^>]*x="([\d.-]+)"[^>]*y="([\d.-]+)"(?:[^>]*text-anchor="(\w+)")?[^>]*>([^<]+)<\/text>/g)) {
    const [, cls, xs, ys, anc = 'start', txt] = m;
    const t = txt.trim();
    if (!t || t === 'P' || t === 'F') continue;      // буквы внутри символов реле
    const x = parseFloat(xs), y = parseFloat(ys);
    const ch = cls === 'st' ? 1.95 : 1.6;
    const w = t.length * ch;
    const x0 = anc === 'middle' ? x - w / 2 : anc === 'end' ? x - w : x;
    texts.push([x0, y - 3.0, x0 + w, y + 0.7, t]);
  }
  const segs = [];
  for (const m of svgHtml.matchAll(/<polyline class="(sl-\w+|s[iw])" points="([^"]+)"/g)) {
    const pts = m[2].trim().split(/\s+/).map((p) => p.split(',').map(Number));
    for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
  }
  const shapes = [];
  for (const m of svgHtml.matchAll(/<rect class="sg2?"[^>]*x="([\d.-]+)"[^>]*y="([\d.-]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/g)) {
    const [x, y, w, h] = m.slice(1).map(Number);
    shapes.push([x, y, x + w, y + h]);
  }
  for (const m of svgHtml.matchAll(/<circle class="sg2?"[^>]*cx="([\d.-]+)"[^>]*cy="([\d.-]+)"[^>]*r="([\d.]+)"/g)) {
    const [cx, cy, r] = m.slice(1).map(Number);
    shapes.push([cx - r, cy - r, cx + r, cy + r]);
  }
  const hits = [];
  const segHit = ([p1, p2], b) => {
    const [x1, y1] = p1, [x2, y2] = p2;
    if (x1 === x2) return b[0] <= x1 && x1 <= b[2] && !(Math.max(y1, y2) < b[1] || Math.min(y1, y2) > b[3]);
    if (y1 === y2) return b[1] <= y1 && y1 <= b[3] && !(Math.max(x1, x2) < b[0] || Math.min(x1, x2) > b[2]);
    return false;
  };
  const boxHit = (a, b) => !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
  for (const b of texts) {
    for (const sgm of segs) if (segHit(sgm, b)) hits.push('линия × «' + b[4] + '»');
    for (const sh of shapes) if (boxHit(sh, b)) hits.push('символ × «' + b[4] + '»');
  }
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++)
      if (boxHit(texts[i], texts[j])) hits.push('«' + texts[i][4] + '» × «' + texts[j][4] + '»');
  return { hits, texts: texts.length, segs: segs.length };
}

test('пустой проект: 24 «назначить» — ничего не пересекается', () => {
  const html = render({});
  const r = overlaps(html);
  assert.ok(r.texts >= 24 * 2, 'подписей меньше ожидаемого: ' + r.texts);
  assert.deepEqual(r.hits, [], 'пересечения: ' + r.hits.join('; '));
});

test('всё назначено длинными именами — тоже чисто', () => {
  const data = {};
  for (const m of src.matchAll(/\{k:'(\w+)',/g)) data[m[1]] = { name: 'МОДЕЛЬ-Ц123456-ДЛИННАЯ' };
  const html = render(data);
  const r = overlaps(html);
  assert.deepEqual(r.hits, [], 'пересечения: ' + r.hits.join('; '));
});

test('на схеме есть зоны, стрелки, легенда, штамп и пульс следующего', () => {
  const html = render({});
  assert.match(html, /ВЫСОКОЕ ДАВЛЕНИЕ/);
  assert.match(html, /НИЗКОЕ ДАВЛЕНИЕ/);
  assert.match(html, /КОНТУР ВОДЫ/);
  assert.match(html, /class="arrh"/);
  assert.match(html, /class="jn"/);
  assert.match(html, /sch-pulse/, 'нет пульса «следующий к назначению»');
  assert.match(html, /АГ\.ЧИЛ-104 Г3/);
  assert.match(html, /горячий газ/);
});

test('тултип и чипы групп подключены', () => {
  assert.match(src, /id="schTip"/);
  assert.match(src, /g\.onmousemove/);
  assert.match(src, /schRenderChips\(\);/);
  assert.match(src, /SCH_GROUPS/);
  assert.match(src, /schGrpToggle/);
});
