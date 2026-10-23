const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('синий FAB стал жёлтым кругляшком и открывает список чатов', () => {
  assert.match(html, /id="devchat-fab" onclick="devChatFabClick\(event\)"/);
  assert.match(html, /id="devchat-fab-picker" class="dchat-fab-picker"/);
  assert.match(html, /id="devchat-fab-picker-list"/);
  assert.match(css, /#devchat-fab \{ background: #FBBF24 !important; color: #1F2937 !important/);
  assert.match(css, /#devchat-fab \{[\s\S]{0,360}width: 46px !important; height: 46px !important/);
  assert.match(app, /if \(_devChatFabMobile\(\)\) devChatFabPickerOpen\(\)/);
  assert.match(app, /_devChatThreads\.map\(function \(t\)/);
  assert.match(app, /function devChatFabChoose\(id\)[\s\S]{0,500}devChatToggleDrawer\(\)/);
});

test('кругляшок переносится долгим нажатием и сохраняет место', () => {
  assert.match(app, /fab\.addEventListener\('pointerdown'/);
  assert.match(app, /d\.dragging = true; fab\.classList\.add\('dragging'\)/);
  assert.match(app, /\}, 320\);/);
  assert.match(app, /fab\.addEventListener\('pointermove'/);
  assert.match(app, /localStorage\.setItem\('atomus_devchat_fab_position'/);
  assert.match(app, /function _devChatFabRestore\(\)/);
  assert.match(app, /fab\.addEventListener\('contextmenu'/);
  assert.match(css, /touch-action: none/);
});
