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
});

test('серверная озвучка не подменяется роботизированным голосом браузера', () => {
  assert.doesNotMatch(app, /SpeechSynthesisUtterance/);
  assert.doesNotMatch(app, /_devChatBrowserSpeak/);
  assert.match(app, /headers\.get\('Content-Type'\)/);
  assert.match(app, /!contentType\.startsWith\('audio\/'\)/);
  assert.match(app, /if \(!blob\.size\)/);
  assert.match(app, /Сервер вернул неверный формат звука/);
  assert.match(app, /Сервер вернул пустой звуковой файл/);
  assert.match(app, /showToast\(_devChatSpeechError\(err\), 'error'\)/);
  assert.match(app, /_dcSpeechSeq\+\+;[\s\S]{0,200}_devChatSpeechDone\(\)/,
    'одна ошибка декодирования не должна показать два уведомления');
});

test('MP3 играет через разблокированный AudioContext, а не новый autoplay', () => {
  assert.match(app, /window\.AudioContext \|\| window\.webkitAudioContext/);
  assert.match(app, /_dcVoiceAudioContext\.state !== 'closed'/,
    'закрытый AudioContext нельзя переиспользовать');
  assert.match(app, /context\.decodeAudioData\(encoded, done, fail\)/);
  assert.match(app, /new Error\('Не удалось декодировать голосовой файл'\)/);
  assert.match(app, /context\.createBufferSource\(\)/);
  assert.match(app, /context\.createBuffer\(1, 1, context\.sampleRate \|\| 44100\)/,
    'iOS требует старт бесшумного буфера внутри пользовательского жеста');
  assert.match(app, /unlock\.start\(0\)/);
  assert.match(app, /source\.connect\(context\.destination\)/);
  assert.match(app, /source\.start\(0\)/);
  assert.match(app, /context\.state !== 'running'[\s\S]{0,80}await context\.resume\(\)/);
  assert.match(app, /Нажмите динамик ещё раз, чтобы разрешить воспроизведение/);
  const voiceStart = app.slice(
    app.indexOf('async function devChatVoiceStart'), app.indexOf('function devChatVoiceMove'));
  const send = app.slice(app.indexOf('async function devChatSend'), app.indexOf('function stopDevChat'));
  assert.match(voiceStart, /if \(_dcVoiceMode\) _devChatPrimeAudioContext\(\)/,
    'после перезапуска PWA микрофон должен заново разблокировать автоголос');
  const voiceUp = app.slice(app.indexOf('function devChatVoiceUp'), app.indexOf('function devChatVoiceEnd'));
  assert.match(voiceUp, /preventDefault[\s\S]{0,100}if \(_dcVoiceMode\) _devChatPrimeAudioContext\(\)/,
    'pointerup должен разблокировать iOS-аудио до завершения записи');
  assert.match(send, /typeof _dcVoiceMode !== 'undefined' && _dcVoiceMode[\s\S]{0,50}_devChatPrimeAudioContext\(\)/,
    'отправка текстом тоже должна разблокировать автоголос');
  assert.match(app, /if \(context\) \{[\s\S]{0,800}return;[\s\S]{0,300}new Audio\(_dcSpeechUrl\)/,
    'HTMLAudio допустим только после ветки AudioContext');
});

test('повторный тап останавливает любой текущий серверный плеер', () => {
  assert.match(app, /if \(btn && _dcSpeechButton === btn && document\.body\.classList\.contains\('dchat-speaking'\)\)/);
  assert.match(app, /_dcSpeechSource\.stop\(0\)/);
  assert.match(app, /_dcSpeechSource\.disconnect\(\)/);
  assert.match(app, /_dcSpeechAudio\.pause\(\); _dcSpeechAudio\.currentTime = 0/);
  assert.match(app, /URL\.revokeObjectURL\(_dcSpeechUrl\)/);
  const stop = app.slice(app.indexOf('function stopDevChat'), app.indexOf('// ============ v2.46.033'));
  assert.match(stop, /_devChatSpeechStop\(\)/, 'уход из чата должен остановить голос');
  assert.match(app, /visibilityState === 'hidden'[\s\S]{0,100}_devChatSpeechStop\(\)/,
    'сворачивание PWA должно остановить голос и индикатор');
});

test('голосовая реплика помечается как обсуждение для серверного предохранителя', () => {
  const finish = app.slice(app.indexOf('async function _dcVoiceFinish'));
  assert.match(finish.slice(0, 3000), /voice_dialogue: true/);
  assert.match(app, /voice_discussion/);
  assert.match(app, /Клава слушает/);
  assert.match(app, /Клава отвечает/);
});
