const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'app-2.js'), 'utf8');

test('Ретро FM доступно в радио через совместимый MP3-поток', () => {
  assert.match(app, /id:\s*'retro_fm'/);
  assert.match(app, /name:\s*'Ретро FM'/);
  assert.match(
    app,
    /url:\s*'https:\/\/retro\.hostingradio\.ru:8014\/retro320\.mp3'/,
  );
});
