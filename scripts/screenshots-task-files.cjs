'use strict';
/* Скрины формы «Новая задача» и карточки задачи.
 * ROOT=... OUT=... MODE=before|after|both node scripts/screenshots-task-files.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const {startHarnessServer, sampleTask} = require('../tests/task-files-harness.cjs');

const outRoot = process.env.OUT || '/workspace/tseh/task_files';
const mode = process.env.MODE || 'both';

async function shot(page, sel, file) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const el = sel ? page.locator(sel) : page;
  if (sel) {
    await el.waitFor({state: 'visible', timeout: 10000});
    await el.screenshot({path: file});
  } else {
    await page.screenshot({path: file, fullPage: true});
  }
  console.log('wrote', file);
}

async function showForm(page) {
  await page.evaluate(() => {
    document.getElementById('slot-form').classList.add('on');
    document.getElementById('slot-card').classList.remove('on');
    state.taskFormMode = 'new';
    state.currentTaskId = null;
    state.taskFormPendingFiles = [];
    renderTaskForm();
  });
  await page.waitForSelector('#tf-title');
}

async function showCard(page, withFiles) {
  await page.evaluate((withFiles) => {
    document.getElementById('slot-form').classList.remove('on');
    document.getElementById('slot-card').classList.add('on');
    state.currentTaskId = 123;
    const files = withFiles ? [
      {id: 11, name: 'схема.pdf', size: 240000, content_type: 'application/pdf', url: '/api/tasks/files/11?e=1&s=1', can_delete: true},
      {id: 12, name: 'щит.dwg', size: 1500000, content_type: 'application/octet-stream', url: '/api/tasks/files/12?e=1&s=1', can_delete: true},
    ] : [];
    const t = {
      id: 123,
      title: 'Проверить чертёж щита',
      description: 'Сверить схему с последней правкой и приложить файл.',
      status: 'new',
      priority: 'normal',
      priority_label: 'Обычный',
      source: 'Планёрка',
      deadline: '',
      created_at: '2026-11-10 08:00:00',
      creator_chat_id: 100,
      assignees: [{ id: 1, name: 'Дмитрий', short_name: 'Дмитрий' }],
      files: files,
      comments: [],
      is_active: 1,
    };
    renderTaskDetail(t);
  }, withFiles);
  await page.waitForSelector('#task-detail-content');
}

async function runMode(page, label) {
  const dir = path.join(outRoot, label);
  fs.mkdirSync(dir, {recursive: true});

  await page.setViewportSize({width: 1366, height: 900});
  await showForm(page);
  await shot(page, '.harness', path.join(dir, 'form-desktop.png'));

  await page.setViewportSize({width: 390, height: 844});
  await showForm(page);
  await shot(page, '.harness', path.join(dir, 'form-mobile.png'));

  await page.setViewportSize({width: 1366, height: 900});
  await showCard(page, false);
  await shot(page, '.harness', path.join(dir, 'card-empty-desktop.png'));
  await showCard(page, true);
  await shot(page, '.harness', path.join(dir, 'card-desktop.png'));

  await page.setViewportSize({width: 390, height: 844});
  await showCard(page, true);
  await shot(page, '.harness', path.join(dir, 'card-mobile.png'));
}

(async () => {
  const {server, url} = await startHarnessServer();
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => typeof renderTaskForm === 'function' && typeof renderTaskDetail === 'function');
  if (mode === 'before' || mode === 'both' || mode === 'after') {
    const label = mode === 'both' ? (process.env.LABEL || 'after') : mode;
    await runMode(page, process.env.LABEL || label);
  }
  if (errors.length) {
    console.error('page errors:', errors);
  }
  await browser.close();
  server.close();
  if (errors.length) process.exit(1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
