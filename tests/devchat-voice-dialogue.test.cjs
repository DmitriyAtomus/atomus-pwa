const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('в шапке и шторке есть явный переключатель голосового диалога', () => {
  assert.equal((html.match(/data-dchat-voice-toggle/g) || []).length, 2);
  assert.match(html, /onclick="devChatVoiceModeToggle\(\)"/);
  assert.match(app, /DCVOICE_MODE_KEY = 'atomus_devchat_voice_dialogue'/);
  assert.match(app, /aria-pressed/);
  assert.match(css, /\.dchat-voice-toggle\.is-on/);
});

test('ответ Клавы можно озвучить вручную и автоматически в голосовом режиме', () => {
  assert.match(app, /onclick="devChatSpeakMsg\(this\)"/);
  assert.match(app, /_devChatApi\('\/speech'\)/);
  assert.match(app, /function _devChatVoiceMaybeSpeak/);
  assert.match(app, /if \(!first\) _devChatVoiceMaybeSpeak\(m, row\)/);
  assert.match(app, /SpeechSynthesisUtterance/, 'нужен запасной голос браузера');
});

test('голосовая реплика помечается как обсуждение для серверного предохранителя', () => {
  const finish = app.slice(app.indexOf('async function _dcVoiceFinish'));
  assert.match(finish.slice(0, 3000), /voice_dialogue: true/);
  assert.match(app, /voice_discussion/);
  assert.match(app, /Клава слушает/);
  assert.match(app, /Клава отвечает/);
});
