const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app2 = fs.readFileSync(path.join(root, 'app-2.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('в карточке задачи есть скрепка, перетаскивание и вставка файлов', () => {
  assert.match(app2, /async function uploadTaskFiles\(fileList\)/);
  assert.match(app2, /\/api\/tasks\/' \+ state\.currentTaskId \+ '\/files'/);
  assert.match(app2, /id="task-disc-attach"/);
  assert.match(app2, /ondrop="_taskDiscDrop\(event\)"/);
  assert.match(app2, /onpaste="_taskDiscPaste\(event\)"/);
  assert.match(app2, /async function deleteTaskFile\(fid\)/);
  assert.match(css, /\.task-disc-attach \{/);
});
