// Чат по чиллерам внутри оболочки «Атом Чиллер» (chiller/index.html).
// Оболочка собирается make_viewer.py из atomus-3d-baza, поэтому тест сторожит
// именно собранный файл: если его пересоберут из старого шаблона, чат пропадёт
// молча — кнопки просто не будет.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'chiller', 'index.html'), 'utf8');

// вырезка кода чата: three.js в файле вшит целиком, гонять его через vm незачем
function chatSection() {
  const from = shell.indexOf('/* ===================== чат по чиллерам');
  const to = shell.indexOf("document.addEventListener('fullscreenchange'", from);
  assert.notEqual(from, -1, 'в оболочке нет блока чата');
  assert.notEqual(to, -1, 'не нашёл конец блока чата');
  return shell.slice(from, to);
}

test('в оболочке есть шторка чата, кнопка и композер', () => {
  assert.match(shell, /<div id="chat">/);
  assert.match(shell, /id="chatFab"[\s\S]*?onclick="openChat\(\)"/);
  assert.match(shell, /id="chIn"/);
  assert.match(shell, /onclick="chatSend\(\)"/);
  assert.match(shell, /onclick="chatStop\(\)"/);      // работу можно остановить отсюда же
  assert.match(shell, /id="chArt"/);                   // макет открывается тут же
  // макет — чужой html, поэтому только в песочнице и только через srcdoc
  assert.match(shell, /id="chArtF" sandbox="allow-scripts/);
  assert.match(chatSection(), /chArtF'\)\.srcdoc/);
});

test('лента берётся из dev-chat, отдельного хранилища у модуля нет', () => {
  const code = chatSection();
  assert.match(code, /CHAT_API = API \? '\/api\/dev-chat'/);
  assert.match(code, /'\/messages\?since_id='/);
  assert.match(code, /chPost\('\/send'/);
  assert.match(code, /chPost\('\/stop'/);
  // просмотрщик ничего не создаёт: пустые дубли чатов рождались как раз так
  assert.doesNotMatch(code, /chPost\('\/projects'/);
  assert.doesNotMatch(code, /chPost\('\/threads'/);
});

test('задача уезжает с пометкой, что открыто в базе', () => {
  const code = chatSection();
  assert.match(code, /screen: 'atom-chiller/);
  assert.match(code, /c\.item = cur\.name/);
  assert.match(code, /context:chContext\(\)/);
});

test('Esc закрывает по порядку: макет, чат, карточку позиции', () => {
  const order = shell.slice(shell.indexOf("if(e.key!=='Escape') return;"),
                            shell.indexOf('function selBlock'));
  assert.match(order, /chatArtClose\(\)[\s\S]*closeChat\(\)[\s\S]*closeDet\(\)/);
});

test('чат ищет живую переписку проекта и ничего не заводит', async () => {
  const ctx = {
    API: '/api/3d', TOKEN: 'test', AUTH: {},
    localStorage: { getItem() { return null; }, setItem() {} },
    document: { getElementById() { return null; } },
    setInterval() { return 1; }, clearInterval() {},
    isMob() { return false; },
    Date, Math, JSON, Set, URL, Object, String, Number, Error, Promise, isNaN, parseInt,
    fetch: async () => ({ ok: true, status: 200, json: async () => ctx.threads }),
  };
  vm.createContext(ctx);
  vm.runInContext(chatSection(), ctx);

  // в проекте два чата: садимся на тот, где есть переписка
  ctx.threads = {
    projects: [{ id: 2, name: 'Атом Чиллер' }],
    threads: [{ id: 9, project_id: 2, msg_count: 0 }, { id: 5, project_id: 2, msg_count: 23 }],
  };
  assert.equal(await ctx.chFindThread(), 5);

  // проекта ещё нет, но чат «Чиллеры» заведён руками — берём его
  ctx.threads = { projects: [], threads: [{ id: 4, project_id: null, title: 'Чиллеры' }] };
  assert.equal(await ctx.chFindThread(), 4);

  // пусто — 0, и никаких POST: завести первый чат есть кому в CRM
  ctx.threads = { projects: [], threads: [] };
  assert.equal(await ctx.chFindThread(), 0);
});

test('чужому кнопка чата не показывается', async () => {
  const shown = [];
  const ctx = {
    API: '/api/3d', TOKEN: 'test', AUTH: {},
    localStorage: { getItem() { return null; }, setItem() {} },
    document: {
      getElementById(id) {
        return { style: {}, addEventListener() {},
                 classList: { add() { shown.push(id); }, toggle() {} } };
      },
    },
    setInterval() { return 1; }, clearInterval() {},
    isMob() { return false; },
    Date, Math, JSON, Set, URL, Object, String, Number, Error, Promise, isNaN, parseInt,
    fetch: async () => ({ ok: false, status: 403, json: async () => ({}) }),
  };
  vm.createContext(ctx);
  vm.runInContext(chatSection(), ctx);
  await ctx.chatArm();
  // ch объявлен через const, в контекст vm как свойство он не попадает — спрашиваем изнутри
  assert.equal(vm.runInContext('ch.arm', ctx), false);
  assert.deepEqual(shown, []);
});

test('первый проход догоняет ленту, а не звонит', () => {
  const code = chatSection();
  // иначе, открыв модуль, сразу получаешь счётчик со всей историей ответов
  assert.match(code, /ch\.first\s*=\s*false/);
  assert.match(code, /!ch\.first\)\{ ch\.unread\+\+/);
  assert.match(code, /first:true/);
});
