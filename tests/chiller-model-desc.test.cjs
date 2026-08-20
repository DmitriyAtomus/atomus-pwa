// Компоновка проекта (chiller/project.html): позиция базы открывается с
// описанием. В списке — заводское наименование и характеристики, по «ⓘ» —
// карточка целиком (характеристики, геометрия, посадка, файл завода).
// Шапка подбора модели рассказывает, что этот узел делает в контуре.
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

// позиция базы ровно в том виде, в каком её отдаёт /api/3d/index
const NRV = {
  id: '020-1010R',
  name: 'NRV 6s 020-1010R',
  brand: 'Ридан',
  section: 'valves', sub: 'serv', lod: 400, ready: true,
  kind: 'Клапан обратный прямоточный NRV 6s, присоединительные патрубки 1/4", под пайку',
  tags: ['NRV 6s', '1/4"', 'пайка ODF', 'Kv 0,56'],
  specs: [['Обозначение', 'NRV 6s'], ['Присоединения', '1/4", под пайку'],
    ['Пропускная способность Kv', '0,56 м³/ч'], ['Максимальное рабочее давление', '46 бар']],
  g: 'line-020-1010R',
  geom: {
    rows: [['Габарит Д × Ш × В', '96,0 × 18,7 × 18,7 мм'], ['Строительная длина', '96 мм']],
    conn: 'патрубки 1/4", пайка', bolt: [0, 0], ports: ['патрубки 1/4"'],
    lod: 'LOD 400 — ЗАВОДСКАЯ геометрия. Исходный файл завода: https://ridan.ru/product/020-1010R/documents/download?fileTypes%5B0%5D=drawings3d',
  },
  dl: null,
};

// descHtml/tagLine — чистые функции строки, гоняем их без DOM
function sandbox() {
  const code = section('function tagLine(d)', 'function openDesc(d,acts)') +
    "\nfunction esc(s){return String(s||'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));}";
  const ctx = { SECTIONS: [['compressors', 'Компрессоры', [['scroll', 'Спиральные']]],
    ['valves', 'Арматура', [['serv', 'Вентили и смотровые стёкла']]]] };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

test('карточка позиции собирает описание, характеристики и посадку', () => {
  const ctx = sandbox();
  const h = ctx.descHtml(NRV, 'line-020-1010R');
  assert.ok(h.includes('Клапан обратный прямоточный NRV 6s'), 'нет заводского наименования');
  assert.ok(h.includes('Пропускная способность Kv') && h.includes('0,56 м³/ч'), 'нет характеристик');
  assert.ok(h.includes('Строительная длина') && h.includes('96 мм'), 'нет разбора геометрии');
  assert.ok(h.includes('Патрубки') && h.includes('патрубки 1/4&quot;'), 'нет патрубков');
  assert.ok(h.includes('Kv 0,56'), 'нет чипов-тегов');
  // ссылка на файл завода — кликабельная, остальное примечание остаётся текстом
  assert.match(h, /<a href="https:\/\/ridan\.ru\/product\/020-1010R[^"]*" target="_blank"/);
  assert.ok(h.includes('LOD 400'), 'потерялось примечание о происхождении геометрии');
});

test('пятно крепления показываем только там, где оно есть', () => {
  const ctx = sandbox();
  assert.ok(!ctx.descHtml(NRV, 'x').includes('Пятно крепления'), 'у клапана лап нет');
  const comp = Object.assign({}, NRV, { geom: { rows: [], bolt: [190.5, 190.5], ports: [] } });
  assert.ok(ctx.descHtml(comp, 'x').includes('190.5 × 190.5 мм'), 'у компрессора пятно лап должно быть');
  // если пятно лап уже есть строкой из базы — второй раз его не печатаем
  const dbl = Object.assign({}, NRV, { geom: { rows: [['Пятно лап', '190,5 × 190,5 мм']], bolt: [190.5, 190.5] } });
  assert.ok(!ctx.descHtml(dbl, 'x').includes('Пятно крепления'), 'пятно продублировалось');
  // заводское наименование стоит описанием в шапке — в характеристиках его нет
  const zav = Object.assign({}, NRV, { specs: [['Наименование завода', 'Клапан обратный'], ['Материал', 'медь']] });
  assert.ok(!ctx.descHtml(zav, 'x').includes('Наименование завода'), 'описание задвоилось');
});

test('данные позиции в карточке экранируются', () => {
  const ctx = sandbox();
  const bad = Object.assign({}, NRV, { kind: '<img src=x onerror=alert(1)>', tags: ['<b>'], specs: [], geom: {} });
  const h = ctx.descHtml(bad, 'x');
  assert.ok(!h.includes('<img src=x'), 'описание попало в разметку как есть');
  assert.ok(h.includes('&lt;b&gt;'), 'тег не экранирован');
});

test('строка списка базы открывается с описанием и кнопкой ⓘ', () => {
  const row = section('function catRow(d,add', 'function bindInfo(box,acts)');
  // hlt — то же экранирование, плюс <mark> на найденных словах (v2.46.003)
  assert.match(row, /class="k'\+\(filt\?' one':''\)\+'">'\+hlt\(kind,tk\)/);        // заводское наименование
  assert.match(row, /class="k tg'\+\(filt\?' full':''\)\+'">'\+hlt\(tagLine\(d\),tk\)/);  // характеристики
  assert.match(row, /class="info" title="Описание позиции">ⓘ/);
  // один и тот же ряд и в подборе на схеме, и в базе компоновки
  assert.match(page, /\$\('#asgList'\)\.innerHTML=list\.map\(d=>catRow\(d,'→',tk\)\)/);
  assert.match(page, /h\+=part\.map\(d=>catRow\(d,'\+',tk\)\)/);
});

test('«ⓘ» открывает карточку, а не назначает и не добавляет деталь', () => {
  const bind = section('function bindInfo(box,acts)', 'let asgKey=null;');
  assert.match(bind, /e\.stopPropagation\(\)/);
  assert.match(page, /bindInfo\('#asgList',d=>\[\{t:'✓ Назначить сюда',pri:true,go:\(\)=>assignTo\(d\)\}\]\)/);
  assert.match(page, /bindInfo\('#cat',d=>\[\{t:'\+ Добавить в сцену',pri:true,go:\(\)=>catPick\(d\)\}\]\)/);
});

test('назначение с карточки идёт тем же путём и пишет шаг истории', () => {
  const as = section('function assignTo(d)', 'function drawAsgList()');
  assert.match(as, /pushHist\('назначение модели на схеме'\)/);
  assert.match(as, /schemaData\[asgKey\]=\{id:d\.id/);
  assert.match(as, /renderSchema\(\);save\(\)/);
});

test('подбор модели открывается с описанием узла контура', () => {
  assert.match(page, /\$\('#asgSub'\)\.textContent=SCH_DESC\[key\]\|\|''/);
  assert.match(page, /<div class="asg-sub" id="asgSub">/);
  // описание есть у каждого узла схемы, иначе шапка окажется пустой
  const nodes = section('const SCH_NODES=[', 'const SCH_DESC=')
    .match(/\{k:'([A-Z0-9]+)'/g).map(m => m.slice(4, -1));
  const desc = section('const SCH_DESC={', 'const SCH_LINES=[');
  assert.equal(nodes.length, 24);
  for (const k of nodes) assert.ok(new RegExp('\\n ' + k + ":'").test(desc), 'нет описания узла ' + k);
});

test('поиск по базе ищет и по характеристикам из тегов', () => {
  // строку поиска собирает hayOf из блока каталога (v2.46.003)
  const code = section('/* ═══ каталог базы', 'const THUMBS=new Map();') +
    ';Object.assign(globalThis,{tkMatch});';
  const ctx = {
    DATA: [], SECTIONS: [['compressors', 'Компрессоры', [['scroll', 'Спиральные']]]],
    SECNAME: { compressors: 'Компрессоры', 'compressors/scroll': 'Спиральные' },
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelectorAll: () => [], querySelector: () => null },
    addEventListener() {}, $: () => null, esc: (v) => String(v || ''),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  assert.ok(ctx.hayOf(NRV).includes('kv 0.56'), 'теги должны попадать в строку поиска');
  assert.ok(ctx.hayOf(NRV).includes('пропускная способность'), 'и характеристики тоже');
  // «компрессор» не написано ни в одной позиции — слово живёт в названии раздела
  const comp = Object.assign({}, NRV, { id: 'YH69T1-100', section: 'compressors', sub: 'scroll',
    name: 'YH69T1-100', brand: 'Invotech', kind: 'Спиральный, A/C и чиллеры', tags: ['R407C'] });
  assert.ok(ctx.hayOf(comp).includes('компрессор'), 'подбор компрессора не найдёт ни одной модели');
  assert.match(page, /SECTIONS=ix\.sections;secNames\(\)/);
  assert.match(page, /list=list\.filter\(d=>tkMatch\(hayOf\(d\),tk\)\)/);  // подбор на схеме
  assert.match(page, /l=l\.filter\(d=>tkMatch\(hayOf\(d\),tk\)\)/);        // база компоновки
});

test('карточку закрывают Esc, крестик и клик мимо', () => {
  const keys = section("addEventListener('keydown'", 'function roleOf');
  assert.match(keys, /if\(\$\('#mdz'\)\.classList\.contains\('on'\)\)\{closeDesc\(\);return;\}/);
  // Esc из карточки не должен сразу закрывать и подбор — сначала верхний слой
  assert.ok(keys.indexOf("#mdz") < keys.indexOf("#asg"), 'порядок слоёв при Esc');
  assert.match(page, /\$\('#mdz'\)\.onclick=e=>\{if\(e\.target\.id==='mdz'\)closeDesc\(\);\}/);
  assert.match(page, /id="mdzX"/);
});

test('у выделенной детали в сцене есть кнопка описания', () => {
  assert.match(page, /<button id="bInfo" title="Описание позиции из базы">ⓘ Описание<\/button>/);
  assert.match(page, /\$\('#bInfo'\)\.onclick=\(\)=>sel&&openDesc\(sel\.d\)/);
});
