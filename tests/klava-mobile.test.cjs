// Клава на телефоне (v2.45.961): шапка-строка вместо заголовка раздела,
// карточка работы вместо трёх точек, итог правки карточкой и голосовой ввод.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('шапка чата — строка: аватар, имя и состояние под ним', () => {
  assert.match(html, /class="page-header dchat-topbar"/);
  assert.match(html, /class="dchat-hd-ava">К<i><\/i><\/div>/);
  // статус переехал под имя, а не висит отдельной пилюлей справа
  const id = html.slice(html.indexOf('dchat-hd-id'), html.indexOf('dchat-hd-right'));
  // с v2.45.964 в заголовке имя текущего чата, поэтому у него есть id
  assert.match(id, /<h1 id="devchat-title">Клава<\/h1>/);
  assert.match(id, /id="devchat-status"/);
  assert.match(css, /\[data-screen="devchat"\] \.dchat-topbar \.dchat-status \{[\s\S]{0,120}background: none/,
    'внутри шапки статус должен быть подписью, а не пилюлей');
});

test('«глаз» и красный «стоп» живут в шапке, стоп появляется только при работе', () => {
  assert.match(html, /class="dchat-eye" onclick="devChatTermOpen\(\)"/);
  assert.match(html, /id="devchat-stop" onclick="devChatStop\(\)"/);
  assert.match(html, /id="devchat-stop"[\s\S]{0,120}style="display:none;"/,
    'кнопка «стоп» не должна висеть, когда останавливать нечего');
  const fn = app.slice(app.indexOf('function _devChatSetStatus'));
  // срез с запасом: блок подсветки шапки (v2.45.984) сдвинул «стоп» ниже,
  // и жёсткие 700 символов его потеряли — проверяем всё тело функции
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /devchat-stop[\s\S]{0,200}mode === 'working'/);
});

test('«Стоп» уходит на сервер и не молчит при отказе', () => {
  const fn = app.slice(app.indexOf('async function devChatStop'));
  assert.match(fn.slice(0, 900), /apiPost\(_devChatApi\('\/stop'\)/);
  // сервер выбирает текущую задачу, но только внутри открытого чата
  assert.match(fn.slice(0, 900), /thread_id: _devChatThreadId \|\| 0/);
  assert.match(fn.slice(0, 900), /showToast\(/);
  // статусы «останавливаю»/«остановлено» должны быть известны ленте
  assert.match(app, /stopping: \{ text: 'останавливаю…'/);
  assert.match(app, /stopped: \{ text: 'остановлено'/);
  const open = app.slice(app.indexOf('function _devChatOpen'));
  assert.match(open.slice(0, 300), /status === 'stopping'/,
    'пока агент не подтвердил остановку, за задачей надо следить');
});

test('вместо трёх точек — карточка работы с таймером и двумя кнопками', () => {
  const fn = app.slice(app.indexOf('function _devChatTyping'));
  assert.match(fn.slice(0, 1600), /class="dchat-work"/);
  assert.match(fn.slice(0, 1600), /devChatTermOpen\(\)/);
  assert.match(fn.slice(0, 1600), /devChatStop\(\)/);
  assert.match(app, /function _devChatWorkFill/);
  // таймер тикает сам: лента обновляется раз в 3 секунды, этого мало
  assert.match(app, /_devChatWorkTimer = setInterval\(function \(\) \{ _devChatWorkFill\(\); \}, 1000\)/);
  assert.match(css, /\.dchat-work \{/);
  assert.match(css, /\.dchat-work \.wk-bar i \{/);
});

test('карточка работы гаснет вместе с лентой', () => {
  const fn = app.slice(app.indexOf('function stopDevChat'));
  // срез с запасом: короткий (300) обрывался на середине последней строки
  assert.match(fn.slice(0, 600), /_devChatWorkTick\(false\)/);
  assert.match(fn.slice(0, 600), /devChatVoiceCancel\(\)/, 'уходя с экрана, микрофон надо отпустить');
});

test('итог правки — карточка с файлами и кнопками, а не стена текста', () => {
  const fn = app.slice(app.indexOf('function _devChatResultCard'));
  assert.match(fn.slice(0, 1600), /meta\.edits/);
  assert.match(fn.slice(0, 1600), /meta\.pr/);
  assert.match(fn.slice(0, 1600), /devChatRepeat\(/);
  // ссылку на PR ставим свойством: escapeHtml не экранирует кавычки
  assert.match(fn.slice(0, 1800), /\/\^https:\\\/\\\/github\\\.com\\\//);
  assert.match(fn.slice(0, 1800), /a\.href = pr\.url/);
  assert.match(app, /_devChatResultCard\(msg\)/, 'карточка не подставляется в пузырь');
  assert.match(css, /\.dchat-res \.rs-f \.pl \{[\s\S]{0,80}#1F7B3F/);
});

test('«Повторить» возвращает задачу в поле, а не отправляет молча', () => {
  const fn = app.slice(app.indexOf('function devChatRepeat'));
  assert.match(fn.slice(0, 600), /input\.value = /);
  assert.doesNotMatch(fn.slice(0, 600), /devChatSend\(/,
    'повтор не должен уходить на сервер сам — формулировку почти всегда правят');
});

test('голос: запись в поле ввода, отправка остаётся ручной', () => {
  assert.match(html, /id="devchat-mic"/);
  assert.match(html, /id="devchat-voice"/);
  assert.match(html, /id="devchat-voice-mic"/);
  const fn = app.slice(app.indexOf('async function devChatVoiceStart'));
  assert.match(fn.slice(0, 1800), /getUserMedia\(\{ audio: true \}\)/);
  assert.match(fn.slice(0, 1800), /new MediaRecorder/);
  const fin = app.slice(app.indexOf('async function _dcVoiceFinish'));
  assert.match(fin.slice(0, 1800), /\/api\/dev-chat\/voice/);
  assert.match(fin.slice(0, 1800), /input\.value = /);
  assert.doesNotMatch(fin.slice(0, 1800), /devChatSend\(/,
    'расшифровку человек должен успеть поправить до отправки');
  // микрофонный поток обязательно отпускаем — иначе на телефоне горит индикатор
  assert.match(app, /function _dcVoiceRelease[\s\S]{0,300}getTracks\(\)\.forEach/);
});

test('голос: короткий тык не считается записью, свайп вниз — отмена', () => {
  assert.match(app, /const DCVOICE_MIN_MS = 400/);
  const up = app.slice(app.indexOf('function devChatVoiceUp'));
  assert.match(up.slice(0, 500), /_dcVoiceLocked = true/, 'короткий тап включает режим «замка»');
  const move = app.slice(app.indexOf('function devChatVoiceMove'));
  assert.match(move.slice(0, 400), /> 70/);
  assert.match(css, /\.dchat-voice\.is-cancel \.vc-mic \{/);
});

test('микрофон и «отправить» не толкаются в поле ввода', () => {
  assert.match(css, /\.dchat-input-row \.dchat-send \{ display: none; \}/);
  assert.match(css, /\.dchat-input-row\.has-text \.dchat-send \{ display: inline-flex; \}/);
  assert.match(css, /\.dchat-input-row\.has-text \.dchat-mic \{ display: none; \}/);
  const grow = app.slice(app.indexOf('function devChatGrow'));
  assert.match(grow.slice(0, 800), /_devChatSendable\(\);/);
  // считаем не только текст: вложение без подписи — тоже готовое сообщение
  const sendable = app.slice(app.indexOf('function _devChatSendable'));
  assert.match(sendable.slice(0, 500), /classList\.toggle\('has-text'/);
  assert.match(sendable.slice(0, 500), /_devChatFiles\.length > 0/);
});

test('обработчики микрофона вешаются один раз и на обе ленты', () => {
  const fn = app.slice(app.indexOf('function _devChatBindVoice'));
  assert.match(fn.slice(0, 900), /devchat-mic/);
  assert.match(fn.slice(0, 900), /devchat-drawer-mic/);
  assert.match(fn.slice(0, 900), /_dcVoiceBound = true/);
  assert.match(app, /_devChatBindVoice\(\);/, 'привязка не вызывается при открытии чата');
});
