// Доводка чата «Клод» (v2.45.957): группы реплик, копирование, лайтбокс,
// компактная мобильная шапка и лента, которая не уезжает за край экрана.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('подряд идущие реплики одного автора склеиваются в группу', () => {
  assert.match(app, /function _devChatGroupRow\(row\)/);
  assert.match(app, /_devChatGroupRow\(row\);/, 'группировка не вызывается при отрисовке');
  const fn = app.slice(app.indexOf('function _devChatGroupRow'));
  assert.match(fn.slice(0, 500), /previousElementSibling/);
  assert.match(fn.slice(0, 500), /is-cont/);
  assert.match(css, /\.dchat-row\.is-cont \.dchat-ava \{ visibility: hidden; \}/,
    'у продолжения группы должен пропадать повторный аватар');
});

test('копирование: блок кода и весь ответ Клода', () => {
  assert.match(app, /function devChatCopyCode\(btn\)/);
  assert.match(app, /function devChatCopyMsg\(btn\)/);
  assert.match(app, /class="dchat-pre"/, 'блок кода не обёрнут — кнопке негде висеть');
  assert.match(app, /onclick="devChatCopyCode\(this\)"/);
  assert.match(app, /onclick="devChatCopyMsg\(this\)"/);
  // clipboard API доступен не в каждом WebView — нужен запасной путь
  assert.match(app, /function _devChatCopyFallback/);
  assert.match(app, /execCommand\('copy'\)/);
  assert.match(css, /\.dchat-copy \{/);
});

test('фото из ленты открывается на весь экран', () => {
  assert.match(app, /openPhotoLightbox\(this\.src\)/);
  assert.match(html, /id="photo-lightbox"/, 'нет самого лайтбокса в разметке');
});

test('чипы прячутся, пока набирается текст', () => {
  const fn = app.slice(app.indexOf('function devChatGrow'));
  assert.match(fn.slice(0, 600), /devchat-chips/);
  assert.match(fn.slice(0, 600), /is-hidden/);
  assert.match(css, /\.dchat-chips\.is-hidden \{ display: none; \}/);
});

test('мобильный экран — колонка: шапка своей высоты, лента забирает остаток', () => {
  assert.match(css, /\.app\.mobile-layout \.screen\.active\[data-screen="devchat"\] \{[^}]*flex-direction: column/);
  assert.match(css, /\.app\.mobile-layout \[data-screen="devchat"\] \.dchat \{ height: auto; flex: 1; min-height: 0; \}/,
    'лента должна тянуться, а не считаться вычитанием фиксированных пикселей');
});

test('быстрый чип подставляет текст без иконки', () => {
  assert.match(html, /<button onclick="devChatQuick\(this\)"><i class="ti /,
    'чипы должны быть с иконками Tabler, а не с эмодзи');
  const fn = app.slice(app.indexOf('function devChatQuick'));
  assert.match(fn.slice(0, 400), /getAttribute\('data-q'\)/,
    'нужен запасной data-q, иначе в поле уедет разметка чипа');
});
