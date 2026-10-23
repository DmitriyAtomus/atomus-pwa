const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'voice-setup.html'), 'utf8');

test('страница отправляет согласие и образец в защищённый API', () => {
  assert.match(html, /form\.append\('consent'/);
  assert.match(html, /form\.append\('sample'/);
  assert.match(html, /\/api\/dev-chat\/custom-voice/);
  assert.match(html, /Authorization: 'Bearer '/);
});

test('образец ограничен тридцатью секундами', () => {
  assert.match(html, /duration > 30\.2/);
  assert.match(html, /не длиннее 30 секунд/);
});

test('после создания можно сразу прослушать согласованную фразу', () => {
  assert.match(html, /Привет, Андрей\. Заведи данные в производство, пожалуйста\./);
  assert.match(html, /\/api\/dev-chat\/speech/);
  assert.match(html, /player\.play\(\)/);
});

test('долгая загрузка получает одноразовый пропуск и идёт напрямую в Railway', () => {
  assert.match(html, /const DIRECT_API = 'https:\/\/worker-production-9b70\.up\.railway\.app'/);
  assert.match(html, /\/api\/dev-chat\/custom-voice-ticket/);
  assert.match(html, /\/api\/dev-chat\/custom-voice-upload\?ticket=/);
  assert.match(html, /encodeURIComponent\(ticketData\.ticket\)/);
  assert.doesNotMatch(html, /custom-voice-upload[\s\S]{0,200}Authorization/);
  assert.match(html, /\[403, 502, 504\]/);
});

test('страница сообщает, что голос сгенерирован ИИ', () => {
  assert.match(html, /голос является сгенерированным ИИ/);
});

test('при истёкшей сессии можно войти по паролю, не покидая страницу', () => {
  assert.match(html, /id="login-panel"/);
  assert.match(html, /id="password" type="password"/);
  assert.match(html, /fetch\('\/api\/auth\/password'/);
  assert.match(html, /localStorage\.setItem\(TOKEN_KEY, data\.token\)/);
  assert.match(html, /response\.status !== 401/);
});

test('отсутствие доступа OpenAI показывается понятным сообщением', () => {
  assert.match(html, /does not have access to this endpoint/);
  assert.doesNotMatch(html, /response\.status === 404 && \/does not have access/);
  assert.match(html, /OpenAI пока не открыл вашей организации функцию Custom Voice/);
  assert.match(html, /Проверить обычный голос/);
  assert.match(html, /create\.dataset\.unavailable/);
});
