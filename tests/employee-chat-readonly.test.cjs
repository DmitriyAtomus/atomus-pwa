const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('сотрудник использует отдельный API, а директор сохраняет канал разработки', () => {
  assert.match(app, /function _devChatEmployeeMode\(\)/);
  assert.match(app, /roles\.indexOf\('director'\) < 0/);
  assert.match(app, /_devChatEmployeeMode\(\) \? '\/api\/employee-chat' : '\/api\/dev-chat'/);
  assert.match(app, /_devChatAgent === 'codex' \? '\/api\/codex-chat'/);
});

test('режим только чтение виден в интерфейсе', () => {
  assert.match(html, /id="devchat-mode-badge"[^>]*>[\s\S]{0,100}Только чтение/);
  assert.match(app, /classList\.toggle\('dchat-employee-readonly', employee\)/);
  assert.match(css, /\.dchat-mode-badge \{/);
  assert.match(css, /dchat-employee-readonly[\s\S]{0,100}\.dchat-eye/);
});

test('сотрудническая Клава объясняет возможности без обещания правок', () => {
  assert.match(app, /искать публичную информацию в интернете/);
  assert.match(app, /только чтение, без команд и изменений/);
  assert.match(app, /Клава видит только разрешённые данные и ничего не изменяет/);
});

test('вложения закрыты в сотрудническом режиме, голос идёт в безопасный API', () => {
  const attach = app.slice(app.indexOf('function devChatAttachMenu'),
    app.indexOf('function _devChatSheetEsc'));
  assert.match(attach, /_devChatEmployeeMode\(\)/);
  const files = app.slice(app.indexOf('function devChatPickFiles'),
    app.indexOf('function _devChatNamed'));
  assert.equal((files.match(/_devChatEmployeeMode\(\)/g) || []).length, 2);
  const voice = app.slice(app.indexOf('async function _dcVoiceFinish'),
    app.indexOf('// Кнопка микрофона'));
  assert.match(voice, /_devChatApi\('\/voice'\)/);
});
