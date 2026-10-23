const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'klava-pick.js'), 'utf8');

test('на телефоне кнопка Клавы круглая и не закрывает ввод', () => {
  assert.match(source, /if \(KP\.cfg\.page === 'crm'\) fab\.classList\.add\('kp-fab-crm'\)/);
  assert.match(source, /#kp-fab\.kp-fab-crm\{[^}]*width:46px!important;[^}]*height:46px!important/s);
  assert.match(source, /#kp-fab\.kp-fab-crm::before\{content:'✦';font-size:22px/);
  assert.match(source, /body\.dchat-ag \.dchat-input\{padding-right:52px\}/);
  assert.match(source, /fab\.setAttribute\('aria-label', 'Показать Клаве'\)/);
});
