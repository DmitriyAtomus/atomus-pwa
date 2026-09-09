const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('внешние CDN-файлы не блокируют первый экран CRM', () => {
  const html = read('index.html');
  assert.match(html, /tabler-icons\.min\.css"\s+media="print"\s+onload="this\.media='all'"/);
  assert.match(html, /<script defer src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/qrcodejs/);
});

test('фоновые вкладки не продолжают основные опросы', () => {
  const app1 = read('app-1.js');
  const app4 = read('app-4.js');

  assert.match(app1, /async function checkForChanges\(\) \{\s+if \(document\.hidden\) return;/);
  assert.match(app1, /async function _devChatTick\(\) \{\s+if \(document\.hidden\) return;/);
  assert.match(app1, /async function refreshNotifBadge\(\) \{\s+if \(document\.hidden\) return;/);
  const app3 = read('app-3.js');
  assert.match(app3, /async function refreshMailUnread\(\) \{\s+if \(document\.hidden\) return;/);
  assert.match(app4, /async function refreshTeamChatsBadge\(\) \{\s+if \(document\.hidden\) return;/);
  assert.match(app4, /async function refreshTvScreenCastState\(\) \{\s+if \(document\.hidden\) return;/);
});

test('при возврате вкладка сразу догоняет открытую переписку и счётчики', () => {
  const app = read('app-1.js');
  assert.match(app, /document\.visibilityState === 'visible'/);
  assert.match(app, /refreshTeamChatsBadge\(\)/);
  assert.match(app, /devChatLoadThreads\(false\)\.then/);
});
