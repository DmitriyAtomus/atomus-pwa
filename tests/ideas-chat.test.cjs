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
  assert.match(acts, /ideaRevision\(/);
  assert.match(acts, /ideaDecline\(/);
});

test('карточка ТЗ в ленте разработки: решение директора одним тапом', () => {
  const card = app1.slice(app1.indexOf('function _devChatIdeaCard'),
                          app1.indexOf('// Итог работы Клавы'));
  assert.match(card, /msg\.meta && msg\.meta\.idea/);
  assert.match(card, /ideaImplement\(' \+ Number\(idea\.id\)/);
  assert.match(card, /ideaRevision\(' \+ Number\(idea\.id\)/);
  assert.match(card, /ideaDecline\(' \+ Number\(idea\.id\)/);
  assert.match(card, /decisions\[msg\.status\]/);
  assert.match(card, /Возвращено на доработку/);
  assert.match(card, /Идея удалена/);
  // карточка подключена к рендеру ленты
  assert.match(app1, /const idea = _devChatIdeaCard\(msg\);/);
  assert.match(css, /\.dchat-idea/);
});

test('чип на карточке показывает ход задачи, а не только «в очереди»', () => {
  // задача внедрения лежит в той же ленте и помнит идею в context —
  // по нему чип и переписывается: в очереди → внедряется → внедрено
  const fn = app1.slice(app1.indexOf('function _devChatIdeaTaskChip'),
                        app1.indexOf('function _devChatIdeaCard'));
  assert.match(fn, /ctx\.source !== 'idea'/);
  assert.match(fn, /data-idea-decision="' \+ Number\(ctx\.idea_id\)/);
  assert.match(app1, /_IDEA_TASK_CHIP = \{[\s\S]*running:[\s\S]*done:[\s\S]*error:/);
  // карточка помечает свой чип адресом, иначе искать нечего
  const card = app1.slice(app1.indexOf('function _devChatIdeaCard'),
                          app1.indexOf('// Итог работы Клавы'));
  assert.match(card, /data-idea-decision="' \+ Number\(idea\.id\)/);
  // чип обновляется и при догрузке ленты, и при опросе статусов
  assert.ok(app1.split('_devChatIdeaTaskChip(m)').length - 1 >= 2);
  assert.match(css, /\.di-decision\.is-work/);
  assert.match(css, /\.di-decision\.is-done/);
});

test('внедрение спрашивает правку и зовёт бэкенд, а не правит само', () => {
  const fn = app4.slice(app4.indexOf('async function ideaImplement'),
                        app4.indexOf('async function ideaDecline'));
  assert.match(fn, /prompt\(/);                       // директор может дописать правку
  assert.match(fn, /'\/implement'/);
  assert.doesNotMatch(fn, /dev-chat\/send/);          // очередь агента дёргает только сервер
});

test('доработка требует комментарий и возвращает ТЗ в тот же чат', () => {
  const fn = app4.slice(app4.indexOf('async function ideaRevision'),
                        app4.indexOf('async function ideaDecline'));
  assert.match(fn, /prompt\(/);
  assert.match(fn, /'\/revision'/);
  assert.match(fn, /ideasOpen\(id\)/);
  assert.doesNotMatch(fn, /dev-chat\/send/);
});

test('директор может переименовать и удалить идею с подтверждением', () => {
  const acts = app4.slice(app4.indexOf('function _ideasRenderActions'),
                          app4.indexOf('function _ideaFormat'));
  assert.match(acts, /state\._ideas\.isDir/);
  assert.match(acts, /ideaRename\(/);
  assert.match(acts, /ideaDelete\(/);

  const rename = app4.slice(app4.indexOf('async function ideaRename'),
                            app4.indexOf('async function ideaDelete'));
  assert.match(rename, /apiPatch\('\/api\/ideas\/' \+ id/);
  assert.match(rename, /ideasLoadListSilent\(\)/);

  const remove = app4.slice(app4.indexOf('async function ideaDelete'),
                            app4.indexOf('// ============ Пароль'));
  assert.match(remove, /confirm\(/);
  assert.match(remove, /Отменить это нельзя/);
  assert.match(remove, /apiDelete\('\/api\/ideas\/' \+ id/);
  assert.match(remove, /state\._ideas\.current = null/);
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
    ['declined', 'done', 'open', 'ready', 'revision', 'sent', 'taken']);
});

// v2.46.024: скриншоты и файлы в чате идей
test('к сообщению можно приложить файл и вставить скриншот из буфера', () => {
  const shell = app4.slice(app4.indexOf('function _ideasRenderShell'),
                           app4.indexOf('function ideasToggleList'));
  assert.match(shell, /id="idea-files"[^>]*multiple/);
  assert.match(shell, /onchange="ideasPickFiles\(this\)"/);
  assert.match(shell, /onpaste="ideasPaste\(event\)"/);
  assert.match(shell, /id="idea-picked"/);
  assert.match(shell, /id="idea-drop-target"/);
  assert.match(shell, /ideasBindDrop\(\)/);
});

test('файл можно перетащить в чат, он прикрепляется без автоотправки', () => {
  const handlers = {};
  const classes = new Set();
  const added = [];
  let focused = 0;
  let sent = 0;
  const host = {
    dataset: {},
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
    },
    addEventListener(name, fn) { handlers[name] = fn; },
  };
  const ctx = {
    Array, Math,
    document: {
      getElementById(id) {
        if (id === 'ideas-main') return host;
        if (id === 'idea-input') return { focus() { focused += 1; } };
        return null;
      },
    },
    _ideasAddPicked(files) { added.push(...files); },
    showToast() {},
    ideaSend() { sent += 1; },
  };
  const start = app4.indexOf('function _ideasTransferHasFiles');
  const end = app4.indexOf('function ideasDropPicked', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  vm.createContext(ctx);
  vm.runInContext(app4.slice(start, end) + '\n;globalThis.bind = ideasBindDrop;', ctx);
  ctx.bind();

  const file = { name: 'образец.xlsx', size: 1000, type: 'application/vnd.ms-excel' };
  const event = {
    dataTransfer: { types: ['Files'], files: [file], dropEffect: '' },
    preventDefault() {},
  };
  handlers.dragenter(event);
  assert.equal(classes.has('is-file-dragging'), true);
  handlers.drop(event);

  assert.deepEqual(added, [file]);
  assert.equal(classes.has('is-file-dragging'), false);
  assert.equal(focused, 1);
  assert.equal(sent, 0);
  assert.match(css, /\.ich-main\.is-file-dragging \.ich-drop-target/);
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

// v2.46.026: сначала макет, потом ТЗ. Порядок держится кнопками (здесь) и
// воротами на бэкенде (my-bot, tests/test_idea_mockup.py).
test('кнопка ТЗ появляется только после согласованного макета', () => {
  const acts = app4.slice(app4.indexOf('function _ideasRenderActions'),
                          app4.indexOf('function _ideaFormat'));
  assert.match(acts, /const mockup = th\.mockup_status \|\| 'none'/);
  assert.match(acts, /Показать макет/);
  assert.match(acts, /Согласовать макет/);
  // «Сформировать ТЗ» — под условием согласованного макета
  const specBtn = acts.slice(acts.indexOf("mockup === 'approved'"));
  assert.match(specBtn, /ideaCompile\(\)/);
  assert.ok(acts.indexOf('ideaCompile()') > acts.indexOf("mockup === 'approved'"),
    'кнопка ТЗ должна стоять после проверки согласования');
  // обход для идей без экрана — есть, но неброский
  assert.match(acts, /ideaCompile\(true\)/);
});

test('макет рисуется и согласуется своими запросами', () => {
  assert.match(app4, /apiPost\('\/api\/ideas\/' \+ id \+ '\/mockup', \{\}\)/);
  assert.match(app4, /apiPost\('\/api\/ideas\/' \+ id \+ '\/mockup\/approve', \{\}\)/);
  // «без макета» уходит явным флагом, иначе бэкенд не пустит
  assert.match(app4, /skip_mockup: true/);
});

test('макет в переписке — живая страница, а не скрепка', () => {
  const files = app4.slice(app4.indexOf('function _ideaIsMockup'),
                           app4.indexOf('function _ideaAddSpec'));
  assert.match(files, /text\/html/);
  assert.match(files, /ideasOpenMockup\(/);
  assert.match(files, /dchat-art/);
  // открывается тем же просмотрщиком, что макеты в ленте разработки
  assert.match(app4, /devChatOpenArtifact\(url, name \|\| 'Макет'\)/);
  assert.match(app1, /function devChatOpenArtifact/);
  for (const cls of ['.ich-chip.is-mockup', '.ich-skip']) {
    assert.ok(css.includes(cls), 'нет стиля ' + cls);
  }
});

// v2.46.035: ТЗ приезжает разобранным по полкам
test('карточка ТЗ рисует шапку «стоит ли» и полки', () => {
  const ctx = {
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
  };
  const src = app1.slice(app1.indexOf('const IDEA_SHELVES'),
                         app1.indexOf('function ideaShelfToggle'));
  vm.createContext(ctx);
  vm.runInContext(src + '\n;globalThis.render = ideaSpecCardHtml;', ctx);

  const html = ctx.render({
    title: 'Кнопка остатков', section: 'Склад → Приёмка', size: 'S', hours: 4,
    benefit: 'экономит 40 минут в неделю', mockup: true,
    why: ['остатки видно только в другом разделе'],
    screen: ['кнопка «Остатки» в шапке'],
    check: ['открыть приёмку и нажать'],
  });
  assert.match(html, /di-title">Кнопка остатков/);
  assert.match(html, /Склад → Приёмка/);
  assert.match(html, /sz-s">S · ~4 ч/);
  assert.match(html, /макет согласован/);
  // первые две полки открыты, остальные свёрнуты
  assert.match(html, /di-shelf is-open[\s\S]*Что мешает сейчас/);
  assert.match(html, /<div class="di-shelf">[\s\S]*Как проверить/);
  // пустых полок нет
  assert.doesNotMatch(html, /Открытые вопросы/);
  // размер не из своего списка в class не попадает
  assert.doesNotMatch(ctx.render({ title: 'т', why: ['п'], size: 'огромный' }), /sz-/);
  // без карточки — пусто, в ленте останется текст ТЗ
  assert.equal(ctx.render(null), '');
});

test('текст ТЗ прячется, когда есть полки, и открывается кнопкой', () => {
  assert.match(app1, /if \(idea && msg\.meta\.idea\.card\) bubble\.classList\.add\('is-idea-card'\)/);
  assert.match(app1, /function ideaSpecTextToggle/);
  assert.match(css, /\.dchat-bubble\.is-idea-card > \.dchat-text \{ display: none; \}/);
  // те же полки видит сотрудник в «Идеях»
  assert.match(app4, /_ideaAddSpec\(th\.spec_text, th\.spec_card\)/);
  assert.match(app4, /ideaSpecCardHtml/);
});
