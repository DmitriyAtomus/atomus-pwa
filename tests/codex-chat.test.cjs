const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');

test('Кодя добавлен отдельным пунктом и не заменяет Клаву', () => {
  assert.match(html, /id="sb-devchat"[\s\S]{0,180}<span>Клава<\/span>/);
  assert.match(html, /id="sb-codex"[^>]*data-nav="codex"[^>]*onclick="selectSidebarItem\('codex'\)"/);
  assert.match(html, /id="sb-codex"[\s\S]{0,180}<span>Кодя<\/span>/);
  assert.match(app, /const navCodex = document\.getElementById\('sb-codex'\)/);
  assert.match(app, /_devChatAgent === 'codex' \? 'Кодя' : 'Клава'/);
  assert.match(app, /_devChatAgent === 'codex' \? 'Ко' : 'К'/);
});

test('один интерфейс выбирает разные API и разную сохранённую беседу', () => {
  assert.match(app, /'codex':\s+'devchat'/);
  assert.match(app, /_devChatAgent === 'codex' \? '\/api\/codex-chat'/);
  assert.match(app, /_devChatEmployeeMode\(\) \? '\/api\/employee-chat' : '\/api\/dev-chat'/);
  assert.match(app, /const CODEXCHAT_THREAD_KEY = 'atomus_codexchat_thread'/);
  assert.match(app, /screenName === 'devchat'\) _devChatUseAgent\('claude'\)/);
  assert.match(app, /screenName === 'codex'[\s\S]{0,100}_devChatUseAgent\('codex'\)/);
  // отправка ушла с fetch на XHR (проценты загрузки), адрес по-прежнему по агенту
  assert.match(app, /_devChatPost\(API_BASE \+ _devChatApi\('\/send'\)/);
});

test('плавающая шторка и чат чиллера остаются у Клавы', () => {
  const drawer = app.slice(app.indexOf('function devChatToggleDrawer()'),
    app.indexOf('// ---- чат по чиллерам'));
  assert.match(drawer, /_devChatUseAgent\('claude'\)/);
  const chiller = app.slice(app.indexOf('async function openChillerChat()'));
  assert.match(chiller, /_devChatUseAgent\('claude'\)/);
  assert.match(chiller, /apiGet\('\/api\/dev-chat\/threads'\)/);
});
