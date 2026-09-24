/* Campaign drafts and manual launch. No send happens on selection or save. */
var _campaigns = { selected: new Set(), current: null, materials: [], draft: null, step: 0, preview: null, busy: false, seq: 0 };
var CAMPAIGN_API = '/api/sales/campaigns';
var CAMPAIGN_STATES = { draft: 'Черновик', running: 'В очереди / отправляется', paused: 'Пауза', cancelled: 'Остановлена', completed: 'Завершена' };
var CAMPAIGN_MESSAGE_STATES = { queued: 'В очереди', sending: 'Отправляется', sent: 'Передано сервису', failed: 'Ошибка', unknown: 'Нужна проверка Resend', skipped: 'Пропущено', cancelled: 'Отменено' };
var CAMPAIGN_OUTCOMES = { '': 'Без результата', replied: 'Ответ получен', brief: 'Данные на расчёт', offer: 'КП подготовлено', won: 'Заказ', later: 'Вернуться позже' };
var CAMPAIGN_TEMPLATES = {
  new: { label: 'Новая камера', subject: 'Предварительный расчёт климата для камеры созревания', body: 'Добрый день, {{contact}}!\n\nПредлагаем подготовить предварительный подбор климатического оборудования для камеры созревания сыра в {{company}}.\n\nЕсли планируете запуск или расширение, пришлите размеры помещения, требуемую температуру и влажность. Если режим ещё не определён — начнём с описания вашей задачи.\n\nМожно ответить на письмо, приложить фото или ТЗ либо оставить заявку по кнопке ниже.' },
  upgrade: { label: 'Модернизация', subject: 'Климат в действующей камере — варианты модернизации', body: 'Добрый день, {{contact}}!\n\nЕсть задача по поддержанию температуры и влажности в камере созревания {{company}}?\n\nАтомус Групп предлагает рассмотреть варианты модернизации климатического оборудования. Для начала достаточно описать, что хотите улучшить, и прислать размеры камеры и фото имеющегося оборудования.\n\nОтветьте на письмо или оставьте заявку — уточним исходные данные для предварительного расчёта.' },
  alternative: { label: 'Расчёт по ТЗ', subject: 'Альтернативный расчёт оборудования для вашей камеры', body: 'Добрый день, {{contact}}!\n\nЕсли у {{company}} уже есть техническое задание на климатическое оборудование для камеры созревания, мы можем подготовить свой вариант подбора и стоимости.\n\nПришлите ТЗ ответом на письмо или через форму ниже. Сравнение состава оборудования поможет обсудить подходящее решение под вашу задачу.' }
};

function campaignsEscape(v) { return escapeHtml(String(v == null ? '' : v)); }
async function campaignsRequest(path, method, body) {
  const headers = { Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(API_BASE + CAMPAIGN_API + path, { method: method || 'GET', headers: headers, body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined, cache: 'no-store' });
  if (!response.ok) {
    const raw = await response.text(); let message = raw;
    try { const parsed = JSON.parse(raw); message = parsed.message || parsed.error || raw; } catch (_) {}
    throw new Error(message.slice(0, 700) || 'Не удалось выполнить запрос');
  }
  return response.json();
}
function campaignsError(e) { showToast(e.message || 'Ошибка рассылки', 'error'); }
async function campaignsRun(fn) {
  if (_campaigns.busy) return;
  _campaigns.busy = true;
  const panel = document.getElementById('campaigns-panel');
  if (panel) { panel.setAttribute('aria-busy', 'true'); panel.querySelectorAll('button').forEach(b => { b.dataset.wasDisabled = b.disabled ? '1' : '0'; b.disabled = true; }); }
  try { await fn(); } catch (e) { campaignsError(e); }
  finally {
    _campaigns.busy = false;
    if (panel) { panel.removeAttribute('aria-busy'); panel.querySelectorAll('button[data-was-disabled]').forEach(b => { b.disabled = b.dataset.wasDisabled === '1'; delete b.dataset.wasDisabled; }); }
  }
}
function campaignsToggle(id, checked) {
  if (checked) _campaigns.selected.add(id); else _campaigns.selected.delete(id);
  campaignsSelectionLabel();
}
function campaignsSelectionLabel() {
  const el = document.getElementById('campaigns-selected');
  if (el) el.textContent = 'Выбрано: ' + _campaigns.selected.size;
}
function campaignsClearSelection() {
  _campaigns.selected.clear(); campaignsSelectionLabel();
  document.querySelectorAll('[data-campaign-select]').forEach(el => { el.checked = false; });
}
async function campaignsSelectFiltered() {
  await campaignsRun(async function () {
    const params = new URLSearchParams();
    document.querySelectorAll('#prospects-filters [data-filter]').forEach(el => { if (el.value) params.set(el.dataset.filter, el.value); });
    const result = await campaignsRequest('/selection?' + params);
    result.ids.forEach(id => _campaigns.selected.add(id)); campaignsSelectionLabel();
    document.querySelectorAll('[data-campaign-select]').forEach(el => { el.checked = _campaigns.selected.has(el.dataset.campaignSelect); });
  });
}
function campaignsPanel() {
  document.getElementById('prospects-overview').hidden = true;
  document.getElementById('prospects-detail').hidden = true;
  const panel = document.getElementById('campaigns-panel'); panel.hidden = false; return panel;
}
function campaignsClose() {
  if (_campaigns.busy) return;
  if (_campaigns.draft && !confirm('Закрыть редактор? Несохранённые изменения будут потеряны.')) return;
  ++_campaigns.seq; _campaigns.draft = null;
  document.getElementById('campaigns-panel').hidden = true;
  document.getElementById('prospects-overview').hidden = false;
}
async function campaignsList() {
  if (_campaigns.draft && !confirm('Перейти к списку? Несохранённые изменения будут потеряны.')) return;
  const seq = ++_campaigns.seq; const panel = campaignsPanel();
  panel.innerHTML = '<p>Загружаем рассылки…</p>';
  try {
    const data = await campaignsRequest(''); if (seq !== _campaigns.seq) return;
    _campaigns.draft = null; _campaigns.materials = data.materials;
    panel.innerHTML = '<div class="campaign-head"><div><h2>Рассылки</h2><p>Отправитель: ' + campaignsEscape(data.sender) + ' · Ответы: ' + campaignsEscape(data.reply_to) + '</p></div><button class="btn btn-secondary" onclick="campaignsClose()">К базе</button></div>' +
      (data.blockers.length ? '<div class="campaign-notice">Можно готовить черновики. Для отправки: ' + data.blockers.map(campaignsEscape).join('; ') + '.</div>' : '') +
      '<div class="campaign-list">' + (data.campaigns.length ? data.campaigns.map(c => '<button class="campaign-card" onclick="campaignsOpen(\'' + c.id + '\')"><b>' + campaignsEscape(c.name) + '</b><span>' + campaignsEscape(CAMPAIGN_STATES[c.status]) + '</span><small>' + new Date(c.created_at * 1000).toLocaleString('ru-RU') + '</small></button>').join('') : '<p>Пока нет рассылок. Выберите предприятия в базе и нажмите «Создать рассылку».</p>') + '</div>';
  } catch (e) { panel.innerHTML = '<button class="btn btn-secondary" onclick="campaignsClose()">К базе</button><p>' + campaignsEscape(e.message) + '</p>'; }
}
async function campaignsNew() {
  if (!canManageSales()) return;
  if (!_campaigns.selected.size) { showToast('Выберите предприятия галочками в таблице', 'error'); return; }
  if (_campaigns.draft && !confirm('Открыть новый черновик? Несохранённые изменения будут потеряны.')) return;
  await campaignsRun(async function () {
    const data = await campaignsRequest(''); _campaigns.materials = data.materials; _campaigns.config = data;
    _campaigns.current = null;
    _campaigns.draft = { name: 'Сыроварни — ' + new Date().toLocaleDateString('ru-RU'), subject: CAMPAIGN_TEMPLATES.new.subject, body: CAMPAIGN_TEMPLATES.new.body, signature: 'С уважением,\nАтомус Групп', recipient_ids: [..._campaigns.selected], materials: [] };
    _campaigns.step = 0; campaignsEditor();
  });
}
async function campaignsOpen(id) {
  if (_campaigns.draft && !confirm('Открыть рассылку? Несохранённые изменения будут потеряны.')) return;
  const seq = ++_campaigns.seq;
  const panel = campaignsPanel(); panel.innerHTML = '<p>Загружаем…</p>';
  try {
    const result = await Promise.all([campaignsRequest('/' + id), campaignsRequest('')]);
    if (seq !== _campaigns.seq) return;
    const c = result[0]; _campaigns.current = c; _campaigns.config = result[1]; _campaigns.materials = result[1].materials;
    if (c.status === 'draft' && canManageSales()) { _campaigns.draft = JSON.parse(JSON.stringify(c.draft)); _campaigns.step = 0; campaignsEditor(); }
    else { _campaigns.draft = null; campaignsReport(c); }
  } catch (e) { panel.innerHTML = '<button class="btn btn-secondary" onclick="campaignsList()">К рассылкам</button><p>' + campaignsEscape(e.message) + '</p>'; }
}
function campaignsEditor() {
  const d = _campaigns.draft; const panel = campaignsPanel();
  panel.innerHTML = '<div class="campaign-head"><h2>Подготовка рассылки</h2><button class="btn btn-secondary" onclick="campaignsList()">К рассылкам</button></div>' +
    '<nav class="campaign-steps" aria-label="Шаги подготовки">' + ['Получатели', 'Материалы', 'Письмо', 'Проверка и запуск'].map((v, i) => '<button class="btn btn-secondary" onclick="campaignsStep(' + i + ')">' + (i + 1) + '. ' + v + '</button>').join('') + '</nav>' +
    '<section data-campaign-step="0"><h3>Выбрано производств: ' + d.recipient_ids.length + '</h3><p>Проверим адреса, дубли, согласие и предыдущие отказы. На одно предприятие — один основной адрес.</p><button class="btn btn-secondary" onclick="campaignsRun(campaignsAudience)">Проверить получателей</button><div id="campaign-audience"></div></section>' +
    '<section data-campaign-step="1" hidden><h3>Материалы</h3><p>PDF до 5 МБ. До трёх материалов в одном письме.</p><label class="campaign-upload">Загрузить PDF<input type="file" accept="application/pdf,.pdf" onchange="campaignsUpload(this)"></label><div id="campaign-materials"></div></section>' +
    '<section data-campaign-step="2" hidden><div class="campaign-fields"><label>Название рассылки<input id="campaign-name" maxlength="150" value="' + campaignsEscape(d.name) + '"></label><label>Шаблон<select onchange="campaignsTemplate(this.value)"><option value="">Выбрать шаблон…</option>' + Object.keys(CAMPAIGN_TEMPLATES).map(k => '<option value="' + k + '">' + CAMPAIGN_TEMPLATES[k].label + '</option>').join('') + '</select></label><label class="wide">Тема<input id="campaign-subject" maxlength="200" value="' + campaignsEscape(d.subject) + '"></label><label class="wide">Текст письма<textarea id="campaign-body" rows="11" maxlength="10000">' + campaignsEscape(d.body) + '</textarea></label><label class="wide">Подпись<textarea id="campaign-signature" rows="3" maxlength="1000">' + campaignsEscape(d.signature) + '</textarea></label></div><p class="campaign-muted">Подстановки: {{company}} — предприятие, {{contact}} — контактное лицо (или «коллеги»). Кнопка расчёта и отказ от рассылки добавляются автоматически.</p></section>' +
    '<section data-campaign-step="3" hidden><div class="campaign-notice">Отправитель: ' + campaignsEscape(_campaigns.config.sender) + '<br>Ответы: ' + campaignsEscape(_campaigns.config.reply_to) + '</div><div id="campaign-review"></div><div class="campaign-fields"><label>Адрес для теста<input id="campaign-test-to" type="email" value="' + campaignsEscape(_campaigns.config.reply_to) + '"></label><label>Отправить по расписанию (ваше местное время)<input id="campaign-schedule" type="datetime-local"></label></div><p>Пустая дата — отправить после запуска. Письма уходят последовательно; запуск требует тестового письма для текущей версии.</p><div class="campaign-toolbar"><button class="btn btn-secondary" onclick="campaignsRun(campaignsTest)">Отправить тест</button><button class="btn btn-primary" onclick="campaignsRun(campaignsLaunch)">Проверить и запустить</button></div><p id="campaign-test-status" role="status"></p></section>' +
    '<div class="campaign-footer"><button class="btn btn-secondary" onclick="campaignsRun(campaignsSave)">Сохранить черновик</button><button id="campaign-next" class="btn btn-primary" onclick="campaignsStep(Math.min(3,_campaigns.step+1))">Следующий шаг →</button><span id="campaign-save-status" role="status"></span></div>';
  campaignsMaterialList(); campaignsShowStep();
  panel.querySelectorAll('#campaign-name,#campaign-subject,#campaign-body,#campaign-signature').forEach(el => el.addEventListener('input', campaignsSync));
}
function campaignsSync() {
  if (!_campaigns.draft) return;
  ['name', 'subject', 'body', 'signature'].forEach(k => { const el = document.getElementById('campaign-' + k); if (el) _campaigns.draft[k] = el.value; });
  _campaigns.preview = null;
}
function campaignsShowStep() {
  document.querySelectorAll('[data-campaign-step]').forEach(el => { el.hidden = Number(el.dataset.campaignStep) !== _campaigns.step; });
  document.querySelectorAll('.campaign-steps button').forEach((el, i) => el.setAttribute('aria-current', i === _campaigns.step ? 'step' : 'false'));
  const next = document.getElementById('campaign-next'); if (next) next.hidden = _campaigns.step === 3;
}
async function campaignsStep(i) {
  if (_campaigns.busy) return;
  campaignsSync(); _campaigns.step = i; campaignsShowStep();
  if (i === 0 || i === 3) await campaignsRun(campaignsAudience);
}
function campaignsTemplate(k) {
  if (!CAMPAIGN_TEMPLATES[k] || !confirm('Заменить тему и текст выбранным шаблоном?')) return;
  document.getElementById('campaign-subject').value = CAMPAIGN_TEMPLATES[k].subject;
  document.getElementById('campaign-body').value = CAMPAIGN_TEMPLATES[k].body; campaignsSync();
}
function campaignsMaterialList() {
  const root = document.getElementById('campaign-materials'); if (!root) return;
  root.innerHTML = _campaigns.materials.length ? _campaigns.materials.map(m => {
    const selected = _campaigns.draft.materials.find(v => v.id === m.id);
    return '<div class="campaign-material"><span><b>' + campaignsEscape(m.name) + '</b><small>' + Math.ceil(m.size / 1024) + ' КБ</small><button class="btn btn-secondary" onclick="campaignsLibraryDownload(\'' + m.id + '\')">Скачать</button></span><select aria-label="Использование материала" onchange="campaignsMaterial(\'' + m.id + '\',this)"><option value="">Не добавлять</option><option value="link"' + (selected && selected.mode === 'link' ? ' selected' : '') + '>Ссылка в письме</option><option value="attachment"' + (selected && selected.mode === 'attachment' ? ' selected' : '') + '>Вложение</option></select></div>';
  }).join('') : '<p>Материалов пока нет. Можно подготовить письмо без буклета.</p>';
}
function campaignsMaterial(id, select) {
  const other = _campaigns.draft.materials.filter(m => m.id !== id);
  if (select.value && other.length >= 3) { showToast('Можно добавить до трёх материалов', 'error'); campaignsMaterialList(); return; }
  _campaigns.draft.materials = other.concat(select.value ? [{ id: id, mode: select.value }] : []); _campaigns.preview = null;
}
async function campaignsUpload(input) {
  const file = input.files[0]; if (!file) return;
  if (file.size > 5 * 1024 * 1024 || !/\.pdf$/i.test(file.name)) { showToast('Выберите PDF до 5 МБ', 'error'); input.value = ''; return; }
  await campaignsRun(async function () {
    const form = new FormData(); form.append('file', file);
    const item = await campaignsRequest('/materials', 'POST', form);
    if (!_campaigns.materials.some(m => m.id === item.id)) _campaigns.materials.unshift(item);
    if (_campaigns.draft.materials.length < 3 && !_campaigns.draft.materials.some(m => m.id === item.id)) _campaigns.draft.materials.push({ id: item.id, mode: 'link' });
    campaignsMaterialList(); input.value = ''; showToast('Материал загружен', 'success');
  });
}
async function campaignsAudience() {
  campaignsSync();
  const result = await campaignsRequest('/preview', 'POST', _campaigns.draft); _campaigns.preview = result;
  const table = '<p><b>Доступно адресов: ' + result.included.length + '</b> · Исключено: ' + result.excluded.length + '</p><div class="campaign-audience-scroll"><table class="prospect-table"><thead><tr><th>Предприятие</th><th>Email / причина</th><th></th></tr></thead><tbody>' + result.included.concat(result.excluded).map(r => '<tr><td>' + campaignsEscape(r.name) + '</td><td>' + campaignsEscape(r.reason || r.email) + '</td><td><button class="btn btn-secondary" onclick="campaignsRemove(\'' + r.id + '\')">Убрать</button></td></tr>').join('') + '</tbody></table></div>';
  document.getElementById('campaign-audience').innerHTML = table;
  const review = document.getElementById('campaign-review');
  review.innerHTML = '<p><b>К отправке: ' + result.included.length + ' адресов.</b> Исключено: ' + result.excluded.length + '.</p><h3>' + campaignsEscape(result.preview.subject) + '</h3><iframe id="campaign-preview-frame" title="Предпросмотр письма" sandbox="" class="campaign-preview"></iframe>' + (_campaigns.config.blockers.length ? '<div class="campaign-notice">' + _campaigns.config.blockers.map(campaignsEscape).join('<br>') + '</div>' : '');
  document.getElementById('campaign-preview-frame').srcdoc = '<meta charset="utf-8">' + result.preview.html;
}
async function campaignsRemove(id) {
  _campaigns.draft.recipient_ids = _campaigns.draft.recipient_ids.filter(v => v !== id);
  if (!_campaigns.draft.recipient_ids.length) { document.getElementById('campaign-audience').textContent = 'Все получатели удалены. Вернитесь к базе для нового выбора.'; return; }
  await campaignsRun(campaignsAudience);
}
async function campaignsSave() {
  campaignsSync(); const c = _campaigns.current;
  // Preserve successful test if no draft field changed.
  if (c && JSON.stringify(c.draft) === JSON.stringify(_campaigns.draft)) return c;
  const result = await campaignsRequest(c ? '/' + c.id : '', c ? 'PUT' : 'POST', { draft: _campaigns.draft, revision: c ? c.revision : undefined });
  _campaigns.current = await campaignsRequest('/' + result.id);
  // Editing local draft must never mutate the saved comparison snapshot.
  _campaigns.draft = JSON.parse(JSON.stringify(_campaigns.current.draft));
  const el = document.getElementById('campaign-save-status'); if (el) el.textContent = 'Черновик сохранён';
  return _campaigns.current;
}
async function campaignsTest() {
  const c = await campaignsSave();
  await campaignsRequest('/' + c.id + '/test', 'POST', { revision: c.revision, to: document.getElementById('campaign-test-to').value });
  _campaigns.current = await campaignsRequest('/' + c.id);
  document.getElementById('campaign-test-status').textContent = 'Тест передан почтовому сервису. Проверьте письмо в своём ящике.';
}
async function campaignsLaunch() {
  const c = await campaignsSave(); await campaignsAudience();
  if (c.tested_revision !== c.revision) throw new Error('Сначала отправьте тест текущей версии письма');
  if (_campaigns.config.blockers.length) throw new Error(_campaigns.config.blockers.join('; '));
  const recipients = _campaigns.preview.included;
  if (!recipients.length) throw new Error('Нет доступных получателей');
  const date = document.getElementById('campaign-schedule').value;
  const when = date ? new Date(date).getTime() / 1000 : null;
  if (date && (!Number.isFinite(when) || when < Date.now() / 1000)) throw new Error('Укажите будущую дату отправки');
  if (!confirm('Запустить рассылку «' + _campaigns.draft.name + '»?\nПолучателей: ' + recipients.length + '\nОтправитель: ' + _campaigns.config.sender + '\nВремя: ' + (date ? new Date(date).toLocaleString('ru-RU') : 'сейчас') + '\n\nПодтверждаю, что тестовое письмо проверено.')) return;
  await campaignsRequest('/' + c.id + '/launch', 'POST', { revision: c.revision, confirm: true, emails: recipients.map(r => r.email), scheduled_at: when });
  _campaigns.draft = null; await campaignsOpen(c.id);
}
function campaignsReport(c) {
  const r = c.recipients;
  const metrics = [[r.length, 'получателей'], [r.filter(v => v.provider_id).length, 'передано сервису'], [r.filter(v => v.events.includes('delivered')).length, 'доставлено'], [r.filter(v => v.events.includes('opened')).length, 'открытия ≈'], [r.filter(v => v.events.includes('clicked')).length, 'переходы ≈'], [r.filter(v => v.lead_contact).length, 'заявки'], [r.filter(v => v.outcome === 'won').length, 'заказы']];
  campaignsPanel().innerHTML = '<div class="campaign-head"><div><h2>' + campaignsEscape(c.draft.name) + '</h2><p>' + CAMPAIGN_STATES[c.status] + (c.scheduled_at ? ' · ' + new Date(c.scheduled_at * 1000).toLocaleString('ru-RU') : '') + '</p></div><button class="btn btn-secondary" onclick="campaignsList()">К рассылкам</button></div><div class="campaign-toolbar"><button class="btn btn-secondary" onclick="campaignsOpen(\'' + c.id + '\')">Обновить результаты</button>' + (canManageSales() ? ((c.status === 'running' ? '<button class="btn btn-secondary" onclick="campaignsAction(\'pause\')">Пауза</button>' : '') + (c.status === 'paused' ? '<button class="btn btn-primary" onclick="campaignsAction(\'resume\')">Продолжить</button>' : '') + (['running', 'paused'].includes(c.status) ? '<button class="btn btn-secondary" onclick="campaignsAction(\'cancel\')">Остановить оставшиеся</button>' : '')) : '') + '</div><div class="campaign-kpis">' + metrics.map(v => '<div class="prospect-kpi"><b>' + v[0] + '</b><span>' + v[1] + '</span></div>').join('') + '</div><p class="campaign-muted">Доставка означает приём почтовым сервером. Открытия и переходы могут включать автоматические проверки. Ответы, КП и заказы отмечаются менеджером; заявки из формы — автоматически. Пауза не отзывает письмо, уже переданное сервису.</p><div class="campaign-audience-scroll"><table class="prospect-table"><thead><tr><th>Предприятие</th><th>Письмо</th><th>Заявка / результат</th></tr></thead><tbody>' + r.map(v => '<tr><td><b>' + campaignsEscape(v.name) + '</b><br>' + campaignsEscape(v.email) + '</td><td>' + campaignsEscape(CAMPAIGN_MESSAGE_STATES[v.state]) + '<br><small>' + campaignsEscape(v.events.map(x => ({ delivered: 'Доставлено', opened: 'Открытие ≈', clicked: 'Переход ≈', bounced: 'Возврат', complained: 'Жалоба', failed: 'Ошибка', sent: 'Отправлено', delivery_delayed: 'Задержка', suppressed: 'Заблокировано' }[x] || x)).join(' · ')) + '</small><br>' + campaignsEscape(v.error) + '</td><td>' + (v.lead_contact ? '<b>Заявка: ' + campaignsEscape(v.lead_need) + '</b><p>' + campaignsEscape([v.lead_contact, v.dimensions, v.climate].filter(Boolean).join(' · ')) + '</p>' + (v.filename ? '<button class="btn btn-secondary" onclick="campaignsDownload(\'' + v.id + '\')">Скачать файл</button>' : '') + '<small>' + campaignsEscape(v.task_id ? 'Задача №' + v.task_id : v.task_error || 'Создаём задачу…') + '</small>' : '') + (canManageSales() ? '<select aria-label="Результат по ' + campaignsEscape(v.name) + '" onchange="campaignsOutcome(\'' + v.id + '\',this.value)">' + Object.keys(CAMPAIGN_OUTCOMES).map(k => '<option value="' + k + '"' + (k === v.outcome ? ' selected' : '') + '>' + CAMPAIGN_OUTCOMES[k] + '</option>').join('') + '</select>' : campaignsEscape(CAMPAIGN_OUTCOMES[v.outcome])) + '</td></tr>').join('') + '</tbody></table></div>';
}
async function campaignsAction(action) {
  await campaignsRun(async function () {
    if (action === 'cancel' && !confirm('Остановить все ещё не отправленные письма? Уже отправленные отозвать нельзя.')) return;
    const id = _campaigns.current.id; await campaignsRequest('/' + id + '/' + action, 'POST', {}); await campaignsOpen(id);
  });
}
async function campaignsOutcome(id, outcome) {
  try { await campaignsRequest('/messages/' + id + '/outcome', 'POST', { outcome: outcome }); await campaignsOpen(_campaigns.current.id); } catch (e) { campaignsError(e); }
}
async function campaignsDownload(id) {
  try {
    const response = await fetch(API_BASE + CAMPAIGN_API + '/messages/' + id + '/file', { headers: { Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) } });
    if (!response.ok) throw new Error('Не удалось скачать файл');
    const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = (_campaigns.current.recipients.find(r => r.id === id) || {}).filename || 'attachment'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { campaignsError(e); }
}
window.addEventListener('beforeunload', function (e) {
  if (_campaigns.draft && (!_campaigns.current || JSON.stringify(_campaigns.draft) !== JSON.stringify(_campaigns.current.draft))) { e.preventDefault(); e.returnValue = ''; }
});

async function campaignsLoadHistory(id, seq) {
  try {
    const result = await campaignsRequest('/history/' + encodeURIComponent(id));
    if (_prospects.detailRequest !== seq) return;
    const el = document.getElementById('prospect-campaign-history'); if (!el) return;
    el.innerHTML = '<details class="prospect-source"><summary>История рассылок (' + result.history.length + ')</summary>' + (result.history.length ? result.history.map(r => '<p><button class="prospect-name" onclick="campaignsOpen(\'' + r.campaign_id + '\')">' + campaignsEscape(r.campaign_name) + '</button><br>' + campaignsEscape(CAMPAIGN_MESSAGE_STATES[r.state]) + (r.sent_at ? ' · ' + new Date(r.sent_at * 1000).toLocaleString('ru-RU') : '') + '<br>' + campaignsEscape(CAMPAIGN_OUTCOMES[r.outcome]) + '</p>').join('') : '<p>Писем из рассылок пока нет.</p>') + '</details>';
  } catch (_) { /* Backend can be rolled out after the UI; keep existing card usable. */ }
}
async function campaignsLibraryDownload(id) {
  try {
    const response = await fetch(API_BASE + CAMPAIGN_API + '/materials/' + id, { headers: { Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) } });
    if (!response.ok) throw new Error('Не удалось скачать материал');
    const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a');
    a.href = url; a.download = (_campaigns.materials.find(m => m.id === id) || {}).name || 'material.pdf'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { campaignsError(e); }
}
