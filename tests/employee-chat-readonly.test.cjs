const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('общий сайт использует отдельный API, а директор сохраняет личный канал разработки', () => {
  assert.match(app, /function _devChatEmployeeMode\(\)/);
  assert.match(app, /return _devChatAgent === 'site'/);
  assert.match(app, /_devChatEmployeeMode\(\) \? '\/api\/site-chat' : '\/api\/dev-chat'/);
  assert.match(app, /_devChatAgent === 'codex' \? '\/api\/codex-chat'/);
  assert.match(html, /id="sb-sitechat"[^>]*data-nav="sitechat"/);
  assert.match(html, /id="sb-sitechat"[\s\S]{0,180}<span>Сайт<\/span>/);
  assert.match(app, /const SITECHAT_THREAD_KEY = 'atomus_sitechat_thread'/);
  assert.match(app, /return _devChatAgent \+ ':' \+ Number/);
});

test('интерфейс показывает общую переписку и read-only CRM', () => {
  assert.match(html, /id="devchat-mode-badge"[^>]*>[\s\S]{0,100}Общий чат сайта/);
  assert.match(app, /classList\.toggle\('dchat-employee-readonly', employee\)/);
  assert.match(app, /общая переписка/);
  assert.match(app, /имена авторов/);
  assert.match(app, /dchat-author/);
  assert.match(css, /\.dchat-author \{/);
  assert.match(css, /\.dchat-mode-badge \{/);
  assert.match(css, /dchat-employee-readonly[\s\S]{0,100}\.dchat-eye/);
});

test('Клава сайта обещает правки только общего сайта', () => {
  assert.match(app, /Это общая переписка по сайту/);
  assert.match(app, /CRM остаётся только источником разрешённых данных без права записи/);
  assert.match(app, /сайт создаёт, меняет и публикует полностью/);
  assert.match(app, /локальный Codex/);
});

test('быстрые действия ведут по полному циклу сайта', () => {
  assert.match(app, /Создай страницу сайта/);
  assert.match(app, /Переделай блок сайта/);
  assert.match(app, /Проверь на телефоне/);
  assert.match(app, /Опубликуй сайт/);
});

test('сотрудник прикладывает файлы, но только те, что Клава прочитает', () => {
  // скрепка доступна всем: у сотрудника это способ показать фото, счёт, смету
  const ui = app.slice(app.indexOf('function _devChatApplyAgentUi'),
    app.indexOf('function _devChatUseAgent'));
  assert.doesNotMatch(ui, /dchat-attach/);
  const attach = app.slice(app.indexOf('function devChatAttachMenu'),
    app.indexOf('function _devChatSheetEsc'));
  assert.doesNotMatch(attach, /_devChatEmployeeMode\(\)/);
  const files = app.slice(app.indexOf('function devChatPickFiles'),
    app.indexOf('function _devChatNamed'));
  assert.doesNotMatch(files, /_devChatEmployeeMode\(\)/);
  assert.match(ui, /Прикрепить файл/);
  assert.match(html, /dchat-attach-label">Файл/);
  assert.match(css, /dchat-employee-readonly \.dchat-attach-label \{ display: inline/);
  assert.match(ui, /файлы можно перетащить прямо в окно/);
  const dropHost = app.slice(app.indexOf('function _devChatDropHost'),
    app.indexOf('function _devChatDropIsFiles'));
  assert.doesNotMatch(dropHost, /_devChatEmployeeMode/);
  const picker = app.slice(app.indexOf('function devChatAttachPick'),
    app.indexOf('// ---- v2.45.961'));
  assert.match(picker, /document\.createElement\('input'\)/);
  assert.match(picker, /devChatPickFiles\(this\.files\)/);
  // предел и список типов повторяют employee_chat.py — отказ виден до загрузки
  const limit = app.slice(app.indexOf('function _devChatFileLimit'),
    app.indexOf('function _devChatSendProgress'));
  assert.match(limit, /EMPCHAT_MAX_IMAGE/);
  assert.match(limit, /EMPCHAT_DOC_EXT/);
  const big = app.slice(app.indexOf('function _devChatTooBig'),
    app.indexOf('async function _devChatUnreadable'));
  assert.match(big, /EMPCHAT_MAX_TOTAL/);
  assert.match(big, /прочитать не сможет/);
});

test('голос сотрудника идёт в безопасный API', () => {
  const voice = app.slice(app.indexOf('async function _dcVoiceFinish'),
    app.indexOf('// Кнопка микрофона'));
  assert.match(voice, /_devChatApi\('\/voice'\)/);
});
