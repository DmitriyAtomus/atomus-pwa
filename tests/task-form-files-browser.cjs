'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {startHarnessServer, sampleTask} = require('./task-files-harness.cjs');

const NODE_SILENT = { skip: false };

async function withPage(fn) {
  const {server, url} = await startHarnessServer();
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const api = [];
  await page.route('**/api/tasks', async route => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = req.postDataJSON() || {};
      api.push({ method: 'POST', path: '/api/tasks', body });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 123, title: body.title || 't', status: 'new' }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"tasks":[]}' });
  });
  await page.route('**/api/tasks/123/files', async route => {
    const req = route.request();
    const fail = page.__failUpload;
    api.push({ method: req.method(), path: '/api/tasks/123/files' });
    if (fail) {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'validation', message: 'Не удалось загрузить' }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        files: [{ id: 51, name: 'чертёж.pdf', size: 12, content_type: 'application/pdf', url: '/api/tasks/files/51?e=1&s=sig', can_delete: true }],
      }),
    });
  });
  await page.route('**/api/tasks/files/**', async route => {
    const req = route.request();
    api.push({ method: req.method(), path: new URL(req.url()).pathname });
    if (req.method() === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/pdf', body: 'PDF' });
  });
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => typeof renderTaskForm === 'function');
  try {
    await fn({ page, api, errors, setFail: v => { page.__failUpload = v; } });
    if (errors.length) throw new Error('pageerror: ' + errors.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
}

function pdf() {
  return { name: 'чертёж.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') };
}

test('форма: кнопка «Прикрепить файл» добавляет файл в локальный список и его можно убрать', async () => {
  await withPage(async ({page}) => {
    await page.evaluate(() => { state.taskFormMode = 'new'; state.taskFormPendingFiles = []; renderTaskForm(); });
    assert.equal(await page.locator('#tf-file-btn').innerText(), await page.locator('#tf-file-btn').innerText());
    assert.match(await page.locator('#tf-file-btn').innerText(), /Прикрепить файл/);
    assert.equal(await page.locator('#tf-files').count(), 1);
    await page.setInputFiles('#tf-file-inp', pdf());
    await page.waitForSelector('.tf-pending');
    assert.match(await page.locator('#tf-files-list').innerText(), /чертёж\.pdf/);
    const n = await page.evaluate(() => (state.taskFormPendingFiles || []).length);
    assert.equal(n, 1);
    await page.click('#tf-files-list .tf-del');
    await page.waitForSelector('#tf-files-empty');
    assert.equal(await page.evaluate(() => (state.taskFormPendingFiles || []).length), 0);
  });
});

test('форма: drag-and-drop кладёт файл в список', async () => {
  await withPage(async ({page}) => {
    await page.evaluate(() => { state.taskFormMode = 'new'; state.taskFormPendingFiles = []; renderTaskForm(); });
    const dt = await page.evaluateHandle(() => {
      const d = new DataTransfer();
      d.items.add(new File(['hello'], 'схема.pdf', { type: 'application/pdf' }));
      return d;
    });
    await page.dispatchEvent('#tf-files', 'dragover', { dataTransfer: dt });
    assert.equal(await page.locator('#tf-files.is-dragover').count(), 1);
    await page.dispatchEvent('#tf-files', 'drop', { dataTransfer: dt });
    await page.waitForSelector('.tf-pending');
    assert.match(await page.locator('#tf-files-list').innerText(), /схема\.pdf/);
  });
});

test('создание задачи: сначала POST /api/tasks, затем загрузка файлов на новый id', async () => {
  await withPage(async ({page, api}) => {
    await page.evaluate(() => {
      state.taskFormMode = 'new';
      state.taskForm.title = 'Проверить чертёж щита';
      state.taskFormPendingFiles = [];
      renderTaskForm();
    });
    await page.setInputFiles('#tf-file-inp', pdf());
    await page.waitForSelector('.tf-pending');
    await page.click('#tf-submit');
    await page.waitForFunction(() => window.__nav === 'task-detail');
    const methods = api.map(a => a.method + ' ' + a.path);
    assert.deepEqual(methods, ['POST /api/tasks', 'POST /api/tasks/123/files']);
    assert.equal(await page.evaluate(() => state.currentTaskId), 123);
    const toasts = await page.evaluate(() => window.__toasts.map(t => t.msg).join('\n'));
    assert.match(toasts, /Задача создана/);
    assert.doesNotMatch(toasts, /не загрузились/);
  });
});

test('ошибка загрузки не теряет созданную задачу и показывает, что не загрузилось', async () => {
  await withPage(async ({page, api, setFail}) => {
    setFail(true);
    await page.evaluate(() => {
      state.taskFormMode = 'new';
      state.taskForm.title = 'Проверить чертёж щита';
      state.taskFormPendingFiles = [];
      renderTaskForm();
    });
    await page.setInputFiles('#tf-file-inp', pdf());
    await page.click('#tf-submit');
    await page.waitForFunction(() => window.__nav === 'task-detail');
    assert.ok(api.some(a => a.path === '/api/tasks' && a.method === 'POST'));
    assert.equal(await page.evaluate(() => state.currentTaskId), 123);
    const fail = await page.evaluate(() => state.taskFileUploadFail);
    assert.ok(fail);
    assert.equal(fail.taskId, 123);
    assert.ok(fail.names.some(n => /чертёж\.pdf/.test(n)));
    const toasts = await page.evaluate(() => window.__toasts.map(t => t.msg).join('\n'));
    assert.match(toasts, /Задача создана, но не загрузились/);
  });
});

test('карточка: кнопка, drop, скачивание и удаление', async () => {
  await withPage(async ({page, api}) => {
    await page.evaluate(() => {
      document.getElementById('slot-form').classList.remove('on');
      document.getElementById('slot-card').classList.add('on');
      state.currentTaskId = 123;
      renderTaskDetail({
        id: 123,
        title: 'Проверить чертёж щита',
        description: 'Текст',
        status: 'new',
        priority: 'normal',
        created_at: '2026-11-10 08:00:00',
        creator_chat_id: 100,
        assignees: [{ id: 1, name: 'Дмитрий' }],
        files: [{ id: 11, name: 'схема.pdf', size: 240000, content_type: 'application/pdf', url: '/api/tasks/files/11?e=1&s=1', can_delete: true }],
        comments: [],
      });
    });
    assert.match(await page.locator('#task-files-attach').innerText(), /Прикрепить файл/);
    const href = await page.locator('.task-file-row[data-fid="11"] a.tf-link').getAttribute('href');
    assert.match(href, /\/api\/tasks\/files\/11/);
    await page.click('.task-file-row[data-fid="11"] .tf-del');
    await page.waitForFunction(() => !document.querySelector('.task-file-row[data-fid="11"]'));
    assert.ok(api.some(a => a.method === 'DELETE' && /\/api\/tasks\/files\/11$/.test(a.path)));

    const dt = await page.evaluateHandle(() => {
      const d = new DataTransfer();
      d.items.add(new File(['%PDF'], 'чертёж.pdf', { type: 'application/pdf' }));
      return d;
    });
    await page.dispatchEvent('#task-files', 'drop', { dataTransfer: dt });
    await page.waitForSelector('.task-file-row[data-fid="51"]');
    assert.ok(api.some(a => a.method === 'POST' && a.path === '/api/tasks/123/files'));
    assert.match(await page.locator('#task-files-rows').innerText(), /чертёж\.pdf/);
  });
});
