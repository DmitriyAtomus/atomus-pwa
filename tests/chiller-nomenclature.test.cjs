// Компоновка проекта (chiller/project.html): выбор номенклатуры из базы 3D —
// категории с числами, поиск по нескольким словам и подсветка совпадений.
// Гоняем настоящий код страницы: поисковый стог, разбор запроса, ранг,
// подсветку и раскладку по разделам — на подставном каталоге.
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

const SECTIONS = [
  ['compressors', 'Компрессоры', [['scroll', 'Спиральные'], ['piston', 'Поршневые']]],
  ['vessels', 'Аппараты', [['recv', 'Ресиверы'], ['filt', 'Фильтры-осушители']]],
  ['pumps', 'Насосы', [['multi', 'Многоступенчатые вертикальные']]],
];
const ITEMS = [
  { id: 'YH69T1-100', name: 'YH69T1-100', brand: 'Invotech', section: 'compressors', sub: 'scroll',
    kind: 'Спиральный, A/C и чиллеры', tags: ['R407C', 'пайка', '6,5 кВт'], ready: true, g: 'a',
    specs: [['Масса нетто', '30 кг']], geom: { conn: '1/2" / 7/8" ODS, пайка', ports: ['нагнетание'] } },
  { id: 'DFL 033 023B7002R', name: 'DFL 033 023B7002R', brand: 'Ридан', section: 'vessels', sub: 'filt',
    kind: 'Герметичный фильтр-осушитель', tags: ['3/8" отбортовка', 'жидкостная'], ready: true, g: 'b',
    specs: [], geom: { conn: '3/8" SAE', ports: [] } },
  { id: 'CS-RV-4,0', name: 'Cold Stream CS-RV-4,0', brand: 'Cold Stream', section: 'vessels', sub: 'recv',
    kind: 'Ресивер вертикальный', tags: ['4 л'], ready: true, g: 'c', specs: [], geom: { conn: '', ports: [] } },
  { id: 'RMV 3-5F', name: 'RMV 3-5F 015P2', brand: 'Ридан', section: 'pumps', sub: 'multi',
    kind: 'Насос вертикальный многоступенчатый', tags: ['DN 25', '3 м³/ч'], ready: true, g: 'd',
    specs: [], geom: { conn: 'G1 1/4', ports: [] } },
  { id: 'HIDDEN-1', name: 'Черновик', brand: 'Атомус', section: 'pumps', sub: 'multi',
    kind: '', tags: [], ready: false, g: 'e', specs: [], geom: {} },
];

/* живой стенд: код каталога со страницы + подставная база и заглушки DOM */
function stand() {
  // const-стрелки со страницы наружу сами не выходят — отдаём их явно
  const code = section('/* ═══ каталог базы (v2.46.003) ═══', 'const THUMBS=new Map();') +
    ';Object.assign(globalThis,{tkMatch,tkFlat,catAll,catFind,normH,kbFlip,' +
    'setQ:(v)=>{fQ=v;},setSec:(a,b)=>{fSec=a||null;fSub=b||null;}});';
  const nodes = {};
  const node = () => ({
    innerHTML: '', textContent: '', value: '', dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelectorAll: () => [], querySelector: () => null,
    scrollTop: 0, focus() {}, select() {}, blur() {},
  });
  const ctx = {
    DATA: ITEMS, SECTIONS, GEOMS: { a: { f: 'a' }, b: { f: 'b' }, c: { f: 'c' }, d: { f: 'd' }, e: { f: 'e' } },
    SECNAME: {}, localStorage: { getItem: () => null, setItem() {} },
    document: { querySelectorAll: () => [], querySelector: () => null },
    addEventListener() {},
    $: (s) => (nodes[s] || (nodes[s] = node())),
    esc: (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    catRow: (d) => '<div class="ci" data-id="' + d.id + '"></div>',
    tagLine: () => '', bindInfo() {}, fillThumbs() {}, addItem() {},
  };
  SECTIONS.forEach((s) => {
    ctx.SECNAME[s[0]] = s[1];
    (s[2] || []).forEach((b) => { ctx.SECNAME[s[0] + '/' + b[0]] = b[1]; });
  });
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  ctx.nodes = nodes;
  return ctx;
}

test('в поисковый стог попадают артикул, характеристики и название раздела', () => {
  const s = stand();
  const h = s.hayOf(ITEMS[0]);
  assert.ok(h.includes('yh69t1-100'), 'артикул');
  assert.ok(h.includes('invotech'), 'бренд');
  assert.ok(h.includes('компрессоры'), 'раздел — слова «компрессор» в самой позиции нет');
  assert.ok(h.includes('спиральные'), 'подраздел');
  assert.ok(h.includes('30 кг'), 'характеристики');
  assert.ok(h.includes('ods'), 'присоединение');
  assert.ok(h.includes('6.5 квт'), 'запятая в числе приводится к точке');
});

test('слова запроса ищутся вместе, а не одной строкой', () => {
  const s = stand();
  const tk = s.qTok('ридан 3/8');
  assert.equal(tk.length, 2);
  assert.ok(s.tkMatch(s.hayOf(ITEMS[1]), tk), 'фильтр Ридан 3/8 — нашёлся');
  assert.ok(!s.tkMatch(s.hayOf(ITEMS[3]), tk), 'насос Ридан без 3/8 — мимо');
});

test('число ищется и с запятой, и с точкой', () => {
  const s = stand();
  assert.ok(s.tkMatch(s.hayOf(ITEMS[0]), s.qTok('6,5')), 'запятая');
  assert.ok(s.tkMatch(s.hayOf(ITEMS[0]), s.qTok('6.5')), 'точка');
});

test('латинская раскладка прощается', () => {
  const s = stand();
  assert.ok(s.tkMatch(s.hayOf(ITEMS[0]), s.qTok('rjvghtccjh')), 'rjvghtccjh — это компрессор');
  assert.ok(s.tkMatch(s.hayOf(ITEMS[3]), s.qTok('yfcjc')), 'yfcjc — это насос');
});

test('совпадение в артикуле весит больше, чем в характеристиках', () => {
  const s = stand();
  const tk = s.qTok('ридан');
  assert.ok(s.tkRank(ITEMS[1], tk) > 0);
  assert.ok(s.tkRank(ITEMS[0], s.qTok('пайка')) === 0, 'слово только в тегах — ранга не даёт');
});

test('подсветка не рвёт разметку и экранирует кавычки', () => {
  const s = stand();
  const h = s.hlt('3/8" отбортовка', s.qTok('3/8'));
  assert.ok(h.includes('<mark>3/8</mark>'), 'совпадение обёрнуто');
  assert.ok(h.includes('&quot;'), 'кавычка экранирована');
  assert.equal(s.hlt('<b>hack</b>', []), '&lt;b&gt;hack&lt;/b&gt;', 'без запроса — просто экранируем');
});

test('выдача считает только готовые позиции и сортирует по рангу', () => {
  const s = stand();
  s.setQ('');
  assert.equal(s.catAll().length, 4, 'черновик в каталог не идёт');
  s.setQ('ридан');
  const r = s.catFind();
  assert.equal(r.found.length, 2);
  assert.ok(r.found.every((d) => d.brand === 'Ридан'));
});

test('раскладка по разделам: без фильтра — все непустые, внутри раздела — подразделы', () => {
  const s = stand();
  s.setSec(null, null);
  const g1 = s.catGroups(s.catAll());
  assert.equal(g1.map((g) => g.k).join('|'), 'compressors|vessels|pumps');
  assert.equal(g1.map((g) => g.items.length).join('|'), '1|2|1');

  s.setSec('vessels', null);
  const g2 = s.catGroups(s.catAll().filter((d) => d.section === 'vessels'));
  assert.equal(g2.map((g) => g.t).join('|'), 'Ресиверы|Фильтры-осушители');

  s.setSec('vessels', 'filt');
  const g3 = s.catGroups(s.catAll().filter((d) => d.sub === 'filt'));
  assert.equal(g3.length, 1);
  assert.equal(g3[0].t, '', 'подраздел выбран — шапка не нужна');
});
