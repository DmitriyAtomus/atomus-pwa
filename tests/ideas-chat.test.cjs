// Раздел «Идеи» (v2.46.017): чат сотрудника с Клавой, ТЗ уходит директору.
// Проверяем то, что легко потерять при следующих правках: экран и пункт меню
// на месте, монтажникам пункт скрыт, замок спрашивает пароль, а карточка ТЗ в
// ленте разработки НЕ запускает правку сама — только по кнопке «Внедрить».
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app1 = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const app4 = fs.readFileSync(path.join(root, 'app-4.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('экран и пункт меню «Идеи» объявлены', () => {
  assert.match(html, /id="sb-ideas"[^>]*onclick="selectSidebarItem\('ideas'\)"/);
  assert.match(html, /data-screen="ideas" data-section="home"/);
  assert.match(html, /id="ideas-body"/);
  // ключ доступа виден только директору — прячем в разметке
  assert.match(html, /id="ideas-key-btn"[\s\S]{0,120}display:none/);
});

test('экран грузится из selectSidebarItem, монтажнику пункт скрыт', () => {
  assert.match(app1, /if \(screenName === 'ideas'\)\s+loadIdeas\(\);/);
  const nav = app1.slice(app1.indexOf("const navIdeas ="), app1.indexOf("const navIdeas =") + 500);
  assert.match(nav, /every\(r => r === 'installer'\)/);
  assert.match(nav, /navIdeas\.style\.display = onlyInstaller \? 'none' : ''/);
});

test('замок: без пароля чат не открывается', () => {
  assert.match(app4, /apiGet\('\/api\/ideas\/state'\)/);
  assert.match(app4, /if \(!st\.unlocked\) \{ _ideasRenderLock\(st\); return; \}/);
  assert.match(app4, /apiPost\('\/api\/ideas\/unlock', \{ password \}\)/);
  // директору объясняем, что пароль ещё не задан
  assert.match(app4, /Пароль ещё не задан/);
});

test('ТЗ собирается и уходит директору двумя разными кнопками', () => {
  assert.match(app4, /apiPost\('\/api\/ideas\/' \+ id \+ '\/compile'/);
  assert.match(app4, /apiPost\('\/api\/ideas\/' \+ id \+ '\/submit'/);
  // «Отправить директору» появляется только когда ТЗ уже есть
  const acts = app4.slice(app4.indexOf('function _ideasRenderActions'),
                          app4.indexOf('function _ideaFormat'));
  assert.match(acts, /th\.spec_text && \(status === 'open' \|\| status === 'ready'\)/);
  assert.match(acts, /ideaSubmit\(\)/);
  // решение директора — отдельные кнопки, они есть только у него
  assert.match(acts, /state\._ideas\.isDir/);
  assert.match(acts, /ideaImplement\(/);
  assert.match(acts, /ideaDecline\(/);
});

test('карточка ТЗ в ленте разработки: решение директора одним тапом', () => {
  const card = app1.slice(app1.indexOf('function _devChatIdeaCard'),
                          app1.indexOf('// Итог работы Клавы'));
  assert.match(card, /msg\.meta && msg\.meta\.idea/);
  assert.match(card, /ideaImplement\(' \+ Number\(idea\.id\)/);
  assert.match(card, /ideaDecline\(' \+ Number\(idea\.id\)/);
  // карточка подключена к рендеру ленты
  assert.match(app1, /const idea = _devChatIdeaCard\(msg\);/);
  assert.match(css, /\.dchat-idea/);
});

test('внедрение спрашивает правку и зовёт бэкенд, а не правит само', () => {
  const fn = app4.slice(app4.indexOf('async function ideaImplement'),
                        app4.indexOf('async function ideaDecline'));
  assert.match(fn, /prompt\(/);                       // директор может дописать правку
  assert.match(fn, /'\/implement'/);
  assert.doesNotMatch(fn, /dev-chat\/send/);          // очередь агента дёргает только сервер
});

test('карточка «Идеи и доработки» в Помощи ведёт в раздел', () => {
  assert.match(app4, /function openIdeasModal\(\) \{ selectSidebarItem\('ideas'\); \}/);
});

test('стили раздела и мобильный список на месте', () => {
  for (const cls of ['.ich-list', '.ich-feed', '.ich-bubble', '.ich-spec', '.ich-lock']) {
    assert.ok(css.includes(cls), 'нет стиля ' + cls);
  }
  assert.match(css, /\.ich\.list-open \.ich-list \{ transform: none; \}/);
});

test('IDEA_STATUS покрывает все статусы бэкенда', () => {
  const ctx = { module: {}, state: {} };
  const src = app4.slice(app4.indexOf('const IDEA_STATUS'), app4.indexOf('function openIdeasModal'));
  vm.createContext(ctx);
  vm.runInContext(src + '\n;globalThis.out = IDEA_STATUS;', ctx);
  assert.deepEqual(Object.keys(ctx.out).sort(),
    ['declined', 'done', 'open', 'ready', 'sent', 'taken']);
});

// v2.46.023: скриншоты и файлы в чате идей
test('к сообщению можно приложить файл и вставить скриншот из буфера', () => {
  const shell = app4.slice(app4.indexOf('function _ideasRenderShell'),
                           app4.indexOf('function ideasToggleList'));
  assert.match(shell, /id="idea-files"[^>]*multiple/);
  assert.match(shell, /onchange="ideasPickFiles\(this\)"/);
  assert.match(shell, /onpaste="ideasPaste\(event\)"/);
  assert.match(shell, /id="idea-picked"/);
});

test('пределы вложений проверяются ДО загрузки', () => {
  const ctx = { showToast: () => {}, state: {}, _ideasRenderPicked: () => {} };
  const src = app4.slice(app4.indexOf('const IDEA_MAX_FILES'),
                         app4.indexOf('function ideasPickFiles'));
  vm.createContext(ctx);
  vm.runInContext(src + '\n;globalThis.add = _ideasAddPicked; globalThis.picked = _ideasPicked;', ctx);
  // шестой файл не берём
  ctx.add(Array.from({ length: 7 }, (_, i) => ({ name: 'f' + i, size: 1000, type: 'image/png' })));
  assert.equal(ctx.picked().length, 5);
  // тяжёлая картинка отсеивается по своему пределу
  ctx.state._ideas.files = [];
  ctx.add([{ name: 'big.png', size: 9 * 1024 * 1024, type: 'image/png' }]);
  assert.equal(ctx.picked().length, 0);
});

test('отправка с файлами идёт multipart с прогрессом, без файлов — как раньше', () => {
  const fn = app4.slice(app4.indexOf('async function ideaSend'),
                        app4.indexOf('async function ideaCompile'));
  assert.match(fn, /new FormData\(\)/);
  assert.match(fn, /form\.append\('file_' \+ \(i \+ 1\), f, f\.name\)/);
  assert.match(fn, /_ideaUpload\(url, form, _ideaSendProgress\)/);
  assert.match(fn, /apiPost\(url, \{ text \}\)/);
  // XHR нужен ради процентов: fetch их не отдаёт
  assert.match(app4, /xhr\.upload\.onprogress/);
});

test('картинка из переписки открывается во весь экран, стили есть', () => {
  const fn = app4.slice(app4.indexOf('function _ideaFilesHtml'),
                        app4.indexOf('function _ideaAddSpec'));
  assert.match(fn, /openPhotoLightbox/);
  assert.match(fn, /API_BASE \+ f\.url/);        // адрес подписывает сервер
  for (const cls of ['.ich-files', '.ich-img', '.ich-pick', '.ich-clip']) {
    assert.ok(css.includes(cls), 'нет стиля ' + cls);
  }
});
