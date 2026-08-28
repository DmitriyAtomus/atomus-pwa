// Чаты и проекты в разделе «Клава».
// Ломается это молча: если лента забудет thread_id, в чат про цех приедет
// переписка про фронт — и человек этого сразу не заметит.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('панель чатов есть в разметке экрана', () => {
  const screen = html.slice(html.indexOf('data-screen="devchat"'),
                            html.indexOf('============ ДАШБОРД'));
  assert.match(screen, /id="devchat-list"/, 'нет панели чатов');
  assert.match(screen, /id="devchat-thread-list"/, 'нет списка бесед');
  assert.match(screen, /id="devchat-proj-tabs"/, 'нет вкладок проектов');
  assert.match(screen, /id="devchat-search"/, 'нет поиска по чатам');
  assert.match(screen, /devChatNewThread\(\)/, 'нет кнопки «Новый чат»');
  assert.match(screen, /devChatProjectsDialog\(\)/, 'нет входа в проекты');
  // лента и композер уехали в свою колонку, иначе панель встала бы сверху
  assert.match(screen, /class="dchat-main"/);
});

test('лента и статусы спрашиваются по текущему чату', () => {
  const tick = app.slice(app.indexOf('async function _devChatTickInner'),
                         app.indexOf('function _devChatSetStatus'));
  assert.match(tick, /thread_id=' \+ _devChatThreadId/,
    'лента тянется без thread_id — приедет чужая переписка');
  const statuses = app.slice(app.indexOf('async function _devChatRefreshStatuses'),
                             app.indexOf('function devChatKey'));
  assert.match(statuses, /thread_id=' \+ _devChatThreadId/);
});

test('задача уходит в открытый чат', () => {
  const send = app.slice(app.indexOf('async function devChatSend'),
                         app.indexOf('// ---------------- чаты (треды)'));
  assert.match(send, /form\.append\('thread_id'/);
});

test('смена чата обнуляет курсор ленты', () => {
  const open = app.slice(app.indexOf('function devChatOpenThread'),
                         app.indexOf('async function devChatNewThread'));
  assert.match(open, /_devChatSince = 0/, 'иначе в новом чате не будет истории');
  assert.match(open, /_devChatPending = new Set\(\)/);
  assert.match(open, /localStorage\.setItem\(_devChatStorageKey\(\)/);
});

test('список чатов обновляется сам и гасится вместе с разделом', () => {
  const load = app.slice(app.indexOf('function loadDevChat(host)'),
                         app.indexOf('function devChatIsFull'));
  assert.match(load, /devChatLoadThreads\(true\)/);
  assert.match(load, /_devChatListTimer = setInterval/);
  const stop = app.slice(app.indexOf('function stopDevChat'),
                         app.indexOf('function stopSecurity'));
  assert.match(stop, /_devChatListTimer/, 'таймер списка остаётся жить после ухода с экрана');
});

test('имена чатов и проектов экранируются', () => {
  const render = app.slice(app.indexOf('function _devChatRenderThreads'),
                           app.indexOf('function devChatFilterProject'));
  assert.match(render, /escapeHtml\(t\.title/);
  assert.match(render, /escapeHtml\(t\.preview/);
  assert.match(render, /escapeHtml\(p\.name\)/);
});

test('на телефоне панель выезжает поверх ленты', () => {
  assert.match(html, /devChatToggleList\(\)/);
  assert.match(css, /\.dchat-list\.is-open \{ transform: none; \}/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]{0,600}\.dchat-list \{[\s\S]{0,200}position: fixed/);
});
