const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');

test('из списка переписок можно написать поставщику первым', () => {
  assert.match(app, /onclick="openNewMailComposer\(\)"/);
  assert.match(app, /Написать письмо/);
  assert.match(app, /apiGet\('\/api\/suppliers'\)/);
  assert.match(app, /id="mail-compose-supplier"/);
});

test('новое письмо отправляется через общий почтовый канал и открывает диалог', () => {
  assert.match(app, /apiPost\('\/api\/mail\/compose', \{ to: to, subject: subject, body: body \}\)/);
  assert.match(app, /await loadMailMessenger\(\)/);
  assert.match(app, /await openMailThread\(to\)/);
});
