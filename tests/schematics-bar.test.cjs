// Щиты (v2.46.166): полоса «Пакеты ЭСКД» над Атом Электрикой — сборка на сервере,
// итог QA, PDF и превью страниц.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app1 = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const app4 = fs.readFileSync(path.join(root, 'app-4.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('полоса на экране и грузится при открытии Атом Электрики', () => {
  assert.match(html, /<div class="schem-bar" id="schem-bar"><\/div>\s*<iframe id="atomcad-frame"/);
  assert.match(app1, /if \(screenName === 'atom-electrica'\) \{[\s\S]*?loadSchematicsBar\(\)/);
});

test('сборка идёт на сервере, итог QA честный, PDF и страницы — с токеном', () => {
  const fn = app4.slice(app4.indexOf('async function loadSchematicsBar()'));
  assert.match(fn, /apiGet\('\/api\/schematics\/panels'\)/);
  assert.match(fn, /apiPost\('\/api\/schematics\/panels\/' \+ encodeURIComponent\(dir\) \+ '\/build', \{\}\)/);
  assert.match(fn, /с замечаниями/);
  assert.match(fn, /qa_skipped/);                                  // «на сервере нет poppler» не прячем
  assert.match(fn, /\/api\/schematics\/builds\/' \+ id \+ '\/pdf'/);
  assert.match(fn, /\/api\/schematics\/builds\/' \+ b\.id \+ '\/page\/' \+ n/);
  assert.match(fn, /'Authorization': 'Bearer ' \+ token/);
  assert.match(css, /\.schem-verdict\.bad/);
});
