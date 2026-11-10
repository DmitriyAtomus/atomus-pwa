'use strict';
/* Общая оснастка для скринов и Playwright: локальный сервер + HTML с формой/карточкой. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {URL} = require('node:url');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function extractApp2Slice() {
  const t = read('app-2.js');
  const start = t.indexOf('const TASK_PRIORITIES = [');
  const end = t.indexOf('\n// ---- Виджет «Мои задачи» на главной ----');
  if (start < 0 || end < start) throw new Error('не нашёл срез задач в app-2.js');
  return t.slice(start, end);
}

function bootstrapJs() {
  return `
window.API_BASE = window.location.origin;
window.TOKEN_KEY = "atomus_token";
try { localStorage.setItem(TOKEN_KEY, "test-token"); } catch (e) {}
window.__toasts = [];
window.__nav = null;
window.__apiLog = [];
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function formatDateLong(iso) {
  try {
    const [y, m, d] = iso.split('-');
    const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
    return d + ' ' + months[parseInt(m) - 1];
  } catch (e) { return iso; }
}
function showToast(msg, kind) { window.__toasts.push({msg: String(msg), kind: kind || 'info'}); }
function selectSidebarItem(name) { window.__nav = name; }
function hasPermission() { return true; }
window.confirm = function () { return true; };
window.cache = window.cache || {};
cache.activeEmployees = [
  { id: 1, short_name: 'Дмитрий', full_name: 'Дмитрий' },
  { id: 2, short_name: 'Анна', full_name: 'Анна Петрова' }
];
cache.tasks = {};
cache.myTasks = null;
cache.homeKpi = null;
cache.contractTasks = {};
window.state = window.state || {};
state.user = { chat_id: 100, employee_id: 1, id: 1, roles: ['director'], permissions: ['tasks.create_for_others'] };
state.taskFormMode = 'new';
state.currentTaskId = null;
state.taskDraftRestored = false;
state.taskAutoPreset = false;
state.taskFormPendingFiles = state.taskFormPendingFiles || [];
state.taskFileUploadFail = state.taskFileUploadFail || null;
state.taskForm = state.taskForm || {
  title: 'Проверить чертёж щита',
  description: 'Сверить схему с последней правкой и приложить файл.',
  assignee_ids: [1],
  deadline: '',
  priority: 'normal',
  source: 'Планёрка',
  contract_id: null,
  contract_label: '',
  category: '',
  panel: ''
};
`;
}

function harnessHtml() {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Задачи — файлы</title>
  <link rel="stylesheet" href="/app.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.47.0/tabler-icons.min.css">
  <style>
    body { margin: 0; background: #F4F6FA; }
    .harness { max-width: 1120px; margin: 0 auto; padding: 18px 22px 40px; }
    .screen-slot { display: none; }
    .screen-slot.on { display: block; }
    .page-header { display: flex; align-items: center; gap: 12px; margin: 0 0 16px; }
    .page-header h1 { margin: 0; font-size: 22px; }
    .page-subtitle { color: var(--text-light, #64748B); font-size: 13px; margin-top: 2px; }
  </style>
</head>
<body>
  <div class="harness">
    <div class="screen-slot on" id="slot-form">
      <div class="page-header">
        <div>
          <h1 id="task-form-title">Новая задача</h1>
          <div class="page-subtitle">Коротко — что, кому и к какому сроку</div>
        </div>
      </div>
      <h2 id="task-form-mob-title" style="display:none">Новая задача</h2>
      <div class="content-inner" id="task-form-content"></div>
    </div>
    <div class="screen-slot" id="slot-card">
      <div class="page-header">
        <div>
          <h1 id="task-detail-title">—</h1>
          <div class="page-subtitle" id="task-detail-subtitle">—</div>
        </div>
      </div>
      <h2 id="task-detail-mob-title" style="display:none">Задача</h2>
      <div class="content-inner" id="task-detail-content"></div>
    </div>
  </div>
  <script src="/harness-boot.js"></script>
  <script src="/harness-app2.js"></script>
</body>
</html>`;
}

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

function startHarnessServer() {
  const boot = bootstrapJs();
  const app2 = extractApp2Slice();
  const html = harnessHtml();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/' || u.pathname === '/harness.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    if (u.pathname === '/harness-boot.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(boot);
    }
    if (u.pathname === '/harness-app2.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(app2);
    }
    const rel = path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, '');
    const file = path.join(root, rel);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address();
      resolve({ server, port, url: 'http://127.0.0.1:' + port + '/harness.html' });
    });
    server.on('error', reject);
  });
}

function sampleTask(extra) {
  return Object.assign({
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
    files: [],
    comments: [],
    is_active: 1,
  }, extra || {});
}

module.exports = {
  root,
  startHarnessServer,
  sampleTask,
  extractApp2Slice,
};
