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

test('в модальном окне есть отдельный выход на рабочую колонку', () => {
  assert.match(app, /> Здесь<\/button>/);
  assert.match(app, /> На колонку<\/button>/);
  assert.match(app, /setRadioTarget\(\\'speaker\\'\)/);
  assert.match(app, /s\.target === 'speaker'/);
});

test('команда на колонку передаёт серверу явную цель воспроизведения', () => {
  assert.match(app, /_radioRemoteCommand\('speaker', 'play', station\)/);
  assert.match(app, /apiPost\('\/api\/tv\/radio',\s*\{\s*target:\s*target,/s);
});

test('громкость рабочей колонки регулируется отдельным ползунком', () => {
  assert.match(app, /speakerVolume:\s*0\.1/);
  assert.match(app, /s\.target === 'speaker'[\s\S]*s\.speakerVolume = pct \/ 100/);
  assert.match(app, /_radioRemoteCommand\('speaker', 'volume', null\)/);
  assert.match(app, /volume:\s+target === 'speaker'/);
});
