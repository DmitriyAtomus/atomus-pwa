// «Показать Клаве» (v2.46.161): общий модуль меток на экране — подключён в CRM и
// в конструкторе чиллера, собирает контекст и шлёт его в чат идей вместе со
// скриншотом. Логику меток гоняем в песочнице с минимальным DOM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const mod = fs.readFileSync(path.join(root, 'klava-pick.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const proj = fs.readFileSync(path.join(root, 'chiller', 'project.html'), 'utf8');
const app4 = fs.readFileSync(path.join(root, 'app-4.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function sandbox() {
  const mk = () => ({ id: '', className: '', style: {}, children: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; }, append() {}, remove() {}, querySelector() { return mk(); }, querySelectorAll() { return []; },
    addEventListener() {}, setAttribute() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h || ''; } });
  const document = { head: mk(), body: mk(), title: 'CRM', createElement: () => mk(), getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, elementFromPoint: () => null };
  const ctx = { window: null, document, location: { pathname: '/x', hash: '' }, innerWidth: 1200, innerHeight: 800, scrollX: 0, scrollY: 0,
    addEventListener() {}, requestAnimationFrame: f => 0, cancelAnimationFrame() {}, setTimeout, fetch: async () => { throw new Error('no net'); } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(mod, ctx);
  return ctx;
}

test('модуль подключён в CRM и в конструкторе, лежит в кэше PWA', () => {
  assert.match(html, /<script src="\/klava-pick\.js"><\/script>/);
  assert.match(html, /KlavaPick\.init\(\{/);
  assert.match(html, /apiBase: API_BASE, token: function/);
  assert.match(proj, /<script src="\.\.\/klava-pick\.js"><\/script>/);
  assert.match(proj, /hostCanvas:'#cv'/);
  assert.match(proj, /partAt:\(x,y\)=>/);
  assert.match(proj, /sceneShot:\(\)=>/);
  assert.match(proj, /preferTopic:'чиллер'/);
  assert.match(sw, /'\/klava-pick\.js'/);
});

test('контекст: экран, версия, метки трёх видов, проверки', () => {
  const w = sandbox();
  w.KlavaPick.init({ apiBase: '', token: () => 't', page: 'chiller', screen: () => 'Атом Чиллер → Конструктор',
    project: () => 'СК-1.5', version: () => 'v1', role: () => 'master', checks: () => ({ 'проверка': 'наезд 2' }) });
  const KP = w.KlavaPick;
  KP.add({ kind: 'part', label: 'N1 · насос', detail: 'x=1 y=2', code: 'layoutByCircuit', rect: [10, 10, 50, 50] });
  KP.add({ kind: 'region', label: 'область 100×40', rect: [0, 0, 100, 40], text: 'Внедрить | Удалить', selector: '#a, #b' });
  KP.add({ kind: 'el', label: 'кнопка «Обвязать»', selector: '#bBind ← div.acts', text: '⚡ Обвязать', rect: [1, 2, 3, 4] });
  const ctx = KP.context();
  assert.equal(ctx.screen, 'Атом Чиллер → Конструктор');
  assert.equal(ctx.project, 'СК-1.5');
  assert.equal(ctx.version, 'v1');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.marks.map(m => [m.n, m.kind]))), [[1, 'part'], [2, 'region'], [3, 'el']]);
  assert.equal(ctx.marks[2].selector, '#bBind ← div.acts');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.checks)), { 'проверка': 'наезд 2' });
  KP.remove(2);
  assert.deepEqual(JSON.parse(JSON.stringify(KP.context().marks.map(m => m.n))), [1, 3]);
  KP.clear();
  assert.equal(KP.context().marks.length, 0);
});

test('отправка: multipart с text, context и скриншотом в /api/ideas/{id}/message', () => {
  const send = mod.slice(mod.indexOf('KP.send = async function'), mod.indexOf('})();', mod.indexOf('KP.send = async function')));
  assert.match(send, /fd\.append\('context', JSON\.stringify\(ctx\)\)/);
  assert.match(send, /fd\.append\('file_1', shot, shot\.name\)/);
  assert.match(send, /KP\.tid \? '\/api\/ideas\/' \+ KP\.tid \+ '\/message' : '\/api\/ideas'/);
  assert.match(send, /KP\.clear\(\)/);                 // метки ушли — экран чистый
  assert.match(mod, /Esc/);
  assert.match(mod, /html2canvas\/1\.4\.1/);             // скриншот DOM
  assert.match(mod, /KP\.cfg\.sceneShot/);              // и 3D-сцена поверх
  const pick = mod.slice(mod.indexOf('KP.pick = function'), mod.indexOf('KP._under'));
  assert.match(pick, /classList\.toggle\('hidden', on/); // панель не закрывает экран, пока ставим метки
});

test('в ленте Идей у сообщения с метками — чип', () => {
  assert.match(app4, /function _ideaCtxHtml\(ctx\)/);
  assert.match(app4, /_ideaCtxHtml\(ctx\) \+/);
  assert.match(app4, /m\.context\);/);
});

// v2.46.164: ТЗ и «Внедрить» из панели; открытие на последней переписке
test('панель: «Сформировать ТЗ» и «Внедрить» прямо здесь, тема запоминается', () => {
  assert.match(mod, /KP\.compile = async function/);
  assert.match(mod, /\/api\/ideas\/' \+ KP\.tid \+ '\/compile'/);
  assert.match(mod, /skip_mockup: true/);
  assert.match(mod, /KP\.implement = async function/);
  assert.match(mod, /\/api\/ideas\/' \+ KP\.tid \+ '\/implement'/);
  assert.match(mod, /ready && KP\.isDir/);                       // «Внедрить» — только директору
  assert.match(mod, /localStorage\.setItem\(KP\._memKey\(\)/);   // где общались в прошлый раз
  assert.match(mod, /localStorage\.getItem\(KP\._memKey\(\)/);
  const show = mod.slice(mod.indexOf('KP.show = async function'), mod.indexOf('KP._memKey'));
  assert.match(show, /await KP\._loadThreads\(\)/);
  assert.match(show, /if \(!KP\.marks\.length && \(fresh \|\| auto\)\) KP\.pick\(true\)/);   // пустая тема или листы щита — сразу метки
  assert.match(mod, /feed\.scrollTop = feed\.scrollHeight/);
});

// v2.46.173: тема щита — «Внести правку» под личным кодом
test('тема щита: «Внести правку» вместо ТЗ, код спрашивается, 428 → задать код', () => {
  const acts = mod.slice(mod.indexOf('KP._renderActs = function'), mod.indexOf('KP._askPin'));
  assert.match(acts, /if \(th\.panel\) \{/);
  assert.match(acts, /id="kp-apply"[^>]*>⚡ Внести правку/);
  assert.match(acts, /правок в работе/);
  const ap = mod.slice(mod.indexOf('KP._askPin'), mod.indexOf('KP.compile = async function'));
  assert.match(ap, /\/api\/me\/pin/);
  assert.match(ap, /\\d\{4,6\}/);
  assert.match(ap, /\/api\/ideas\/' \+ KP\.tid \+ '\/apply'/);
  assert.match(ap, /r\.status === 428/);
  assert.match(ap, /JSON\.stringify\(\{ pin: pin, note: note\.trim\(\) \}\)/);
});

// v2.46.174: длинные листы — колесо, привязка рамки, «Готово»
test('в режиме меток колесо крутит прокрутку под курсором, рамка держится за элемент, есть «Готово»', () => {
  assert.match(mod, /layer\.addEventListener\('wheel', KP\._onWheel, \{ passive: false \}\)/);
  assert.match(mod, /KP\._scrollerAt = function/);
  assert.match(mod, /KP\._anchor = function \(m\)/);
  assert.match(mod, /m\.anchorFr = \[/);
  assert.match(mod, /else if \(m\.anchor && m\.anchor\.isConnected && m\.anchorFr\)/);
  assert.match(mod, /id="kp-done">✓ Готово/);
});

// v2.46.178: ответ Клавы опросом
test('панель шлёт async и ждёт ответ опросом темы', () => {
  assert.match(mod, /fd\.append\('async', '1'\)/);
  assert.match(mod, /KP\._waitReply = async function \(tid, msgId, ph\)/);
  assert.match(mod, /m\.role === 'assistant' && m\.id > msgId/);
  assert.match(mod, /if \(!th\.pending\)/);
  assert.match(mod, /if \(r\.data\.pending\) reply = await KP\._waitReply/);
  assert.match(app4, /async function _ideaWaitReply\(tid, msgId, ph\)/);
  assert.match(app4, /form\.append\('async', '1'\)/);
  assert.match(app4, /\{ text, async: true \}/);
});

// v2.46.182: убрать метку
test('метку убирает клик по номеру, «↺ Сбросить» убирает все', () => {
  assert.match(mod, /d\.querySelector\('\.pin'\)\.onclick = \(e\) => \{ e\.stopPropagation\(\); KP\.remove\(m\.n\); \}/);
  assert.match(mod, /id="kp-reset"[^>]*>↺ Сбросить/);
  assert.match(mod, /if \(KP\.cfg && KP\.cfg\.remote && !KP\.picking\) KP\._remoteDone\(\)/);
});
