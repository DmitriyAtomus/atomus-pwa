const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app1 = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const app4 = fs.readFileSync(path.join(root, 'app-4.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('раздел сайтов содержит отдельный экран живых диалогов', () => {
  assert.match(html, /data-screen="sites-chats"/);
  assert.match(html, /id="sites-chats-badge"/);
  assert.match(app1, /screenName === 'sites-chats'/);
  assert.match(app4, /async function loadSitesChats\(\)/);
  assert.match(app4, /async function sitesChatSend\(event\)/);
});

test('сообщения и вложения диалога экранируются перед выводом', () => {
  assert.match(app4, /escapeHtml\(m\.text \|\| ''\)/);
  assert.match(app4, /escapeHtml\(f\.url \|\| '#'\)/);
  assert.match(app4, /escapeHtml\(f\.original_name \|\| 'Файл'\)/);
  assert.match(css, /\.st-chat-layout|\.st-chat-list/);
});
