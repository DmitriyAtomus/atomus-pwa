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
