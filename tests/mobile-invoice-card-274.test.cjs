const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const test = require('node:test');
const app3 = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');
test('карточка счёта: полноэкранная на телефоне, крупная кнопка, без «Закрыть»', () => {
  assert.match(app3, /modal-overlay inv-modal-overlay/);
  assert.match(app3, /inv-modal-primary/);
  const i = app3.indexOf('inv-modal-footer'); const block = app3.slice(i, i + 2500);
  assert.doesNotMatch(block, />Закрыть</);
  assert.match(css, /\.inv-modal-overlay \.inv-modal[\s\S]*100dvh/);
  assert.match(css, /safe-area-inset-bottom/);
});
test('модалка прячет плашки и плавающие кнопки', () => {
  assert.match(css, /body:has\(\.modal-overlay\.visible\) \.supply-author-alerts/);
  assert.match(css, /body:has\(\.modal-overlay\.visible\) #kp-fab/);
});
test('PDF на телефоне рисуется pdf.js', () => {
  assert.match(app3, /_inboxInvRenderPdfMobile\(cont, blob, url, filename\)/);
});
const app1 = fs.readFileSync(path.join(__dirname, '..', 'app-1.js'), 'utf8');
const app4 = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');
test('жёлтые круглые кнопки скрыты на телефоне, функции — в «Ещё»', () => {
  assert.match(css, /@media \(max-width: 720px\) \{\s*#kp-fab, #devchat-fab \{ display: none !important; \}/);
  assert.match(app4, /Показать Клаве<\/span>/);
  assert.match(app4, /devChatFabPickerOpen\(\);\}catch/);
  assert.doesNotMatch(css, /height: 88px/);
});
test('автообновление в первые 30 с после запуска', () => {
  assert.match(app4, /_swAppStartTs/);
  assert.match(app4, /_early\) && _swAutoApplyIfSafe\(reg\)/);
});
test('журнал изменений не падает без features', () => {
  assert.match(app4, /Array\.isArray\(v\.features\) \? v\.features : \[\]/);
});
test('тяжёлые 3D-экраны на телефоне — заглушка', () => {
  assert.match(app1, /_mobileHeavyGuard\('chiller-frame'/);
  assert.match(app1, /h-scroll-hint/);
});
