const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// v2.46.249: Chrome/Яндекс автоперевод «переводил» русские подписи меню
// («Изделия 3D» → «ра 3D», «Сервис» → «десятый»). CRM и встроенные модули
// должны запрещать машинный перевод страницы.
for (const file of ['index.html', 'chiller/index.html', 'atomcad/index.html', 'syrovarnya/index.html']) {
  test(`${file}: автоперевод браузера отключён`, () => {
    const html = read(file);
    assert.match(html, /<html lang="ru" translate="no" class="notranslate">/);
    assert.match(html, /<meta name="google" content="notranslate">/);
  });
}
