/* Dairy manufacturers — server-backed records; all outbound communication stays manual. */
var _prospects = { page: 1, request: 0, detailRequest: 0, current: null, dict: null, file: null, preview: false };
var PROSPECT_LABELS = { stage: 'Этап', owner: 'Ответственный', contact_person: 'Контактный специалист',
  contact_role: 'Должность', need: 'Задача клиента', next_action: 'Следующий шаг', next_date: 'Дата контакта',
  consent: 'Согласие на рассылку', consent_basis: 'Основание согласия', consent_date: 'Дата согласия',
  comment: 'Заметки', qualification: 'Профиль производства', email: 'Email', phone: 'Телефон', site: 'Сайт' };
var PROSPECT_QUALIFICATIONS = { unknown: 'Ещё не уточнён', cheese: 'Выпускает выдержанные сыры',
  milk: 'Молочная продукция / другой ассортимент', inactive: 'Не действует' };

function prospectsEscape(value) { return escapeHtml(String(value == null ? '' : value)); }
function prospectsUrl(value) {
  try { const u = new URL(String(value || '').trim()); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; }
  catch (_) { return ''; }
}
function prospectsLinks(value) {
  return (String(value || '').match(/https?:\/\/[^\s;|]+/g) || []).map(function (raw) {
    const url = prospectsUrl(raw); return url ? '<a href="' + prospectsEscape(url) + '" target="_blank" rel="noopener noreferrer">' + prospectsEscape(raw) + '</a>' : '';
  }).join('<br>');
}
function prospectsDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.slice(8) + '.' + value.slice(5, 7) + '.' + value.slice(0, 4) : (value || '—');
}
function prospectsOptions(dict, value, empty) {
  return (empty !== undefined ? '<option value="">' + prospectsEscape(empty) + '</option>' : '') +
    Object.keys(dict || {}).map(function (k) { return '<option value="' + prospectsEscape(k) + '"' + (k === value ? ' selected' : '') + '>' + prospectsEscape(dict[k]) + '</option>'; }).join('');
}
function prospectsFilter() { _prospects.page = 1; loadProspects(); }
function prospectsSearch() { clearTimeout(_prospects.searchTimer); _prospects.searchTimer = setTimeout(prospectsFilter, 300); }
function prospectsPage(delta) { _prospects.page += delta; loadProspects(); }
function prospectsReset() {
  document.querySelectorAll('#prospects-filters input,#prospects-filters select').forEach(function (el) { el.value = ''; });
  prospectsFilter();
}

async function loadProspects() {
  const root = document.getElementById('prospects-list'); if (!root) return;
  const seq = ++_prospects.request;
  const params = new URLSearchParams({ page: _prospects.page });
  document.querySelectorAll('#prospects-filters [data-filter]').forEach(function (el) { if (el.value) params.set(el.dataset.filter, el.value); });
  root.setAttribute('aria-busy', 'true');
  const importButton = document.getElementById('prospects-import-button');
  if (importButton) importButton.hidden = !canManageSales();
  try {
    const result = await apiGet('/api/sales/prospects?' + params.toString());
    if (seq !== _prospects.request) return;
    _prospects.dict = result; _prospects.page = result.page;
    const s = result.stats;
    document.getElementById('prospects-kpis').innerHTML = [[s.total, 'производств'], [s.email || 0, 'с почтой'], [s.phone || 0, 'с телефоном'], [s.working || 0, 'в работе'], [s.due || 0, 'контакт сегодня / просрочен']].map(function (v) {
      return '<div class="prospect-kpi"><b>' + prospectsEscape(Number(v[0]).toLocaleString('ru-RU')) + '</b><span>' + v[1] + '</span></div>';
    }).join('');
    ['segment', 'region', 'owner', 'stage'].forEach(function (key) {
      const el = document.querySelector('#prospects-filters [data-filter="' + key + '"]');
      const value = el.value;
      const dict = key === 'stage' ? result.stages : Object.fromEntries(result.facets[key].map(function (v) { return [v, v]; }));
      el.innerHTML = prospectsOptions(dict, value, el.dataset.empty);
    });
    document.getElementById('prospects-count').textContent = 'Найдено: ' + result.total.toLocaleString('ru-RU');
    if (!result.rows.length) root.innerHTML = '<div class="empty-block">По этим условиям производств нет. Измените фильтры.</div>';
    else root.innerHTML = '<div class="prospect-table-wrap"><table class="prospect-table"><thead><tr><th>Производство</th><th>Контакты</th><th>Этап / ответственный</th><th>Следующий шаг</th></tr></thead><tbody>' +
      result.rows.map(function (r) {
        const site = prospectsUrl(r.site); const firstPhone = (r.phone || '').split(';')[0].trim();
        return '<tr><td><button class="prospect-name" onclick="prospectsOpen(\'' + r.id + '\')">' + prospectsEscape(r.name) + '</button>' +
          '<div class="prospect-meta">' + prospectsEscape(r.segment) + '</div><div class="prospect-meta">' + prospectsEscape([r.region, r.city].filter(Boolean).join(' · ')) + '</div></td>' +
          '<td><div>' + (r.email ? prospectsEscape(r.email) : '<span class="prospect-missing">Почта не найдена</span>') + '</div><div>' +
          (/^\+\d{11,15}$/.test(firstPhone) ? '<a href="tel:' + firstPhone + '">' + prospectsEscape(firstPhone) + '</a>' : prospectsEscape(firstPhone || 'Телефон не найден')) + '</div>' +
          (site ? '<a href="' + prospectsEscape(site) + '" target="_blank" rel="noopener noreferrer">Сайт ↗</a>' : '') +
          '<div class="prospect-meta">' + prospectsEscape(r.verification) + '</div></td>' +
          '<td><span class="prospect-stage">' + prospectsEscape(result.stages[r.stage] || r.stage) + '</span><div class="prospect-meta">' + prospectsEscape(r.owner || 'Не назначен') + '</div></td>' +
          '<td><div>' + prospectsEscape(r.next_action || 'Уточнить профиль и нужного специалиста') + '</div><div class="prospect-meta">' + prospectsEscape(prospectsDate(r.next_date)) + '</div></td></tr>';
      }).join('') + '</tbody></table></div>';
    document.getElementById('prospects-pagination').innerHTML = '<button class="btn btn-secondary" onclick="prospectsPage(-1)"' + (result.page <= 1 ? ' disabled' : '') + '>← Назад</button><span>' + result.page + ' / ' + result.pages + '</span><button class="btn btn-secondary" onclick="prospectsPage(1)"' + (result.page >= result.pages ? ' disabled' : '') + '>Далее →</button>';
  } catch (e) {
    if (seq === _prospects.request) root.innerHTML = '<div class="empty-block">' + prospectsEscape(e.message || 'Не удалось загрузить базу') + '<br><button class="btn btn-secondary" onclick="loadProspects()">Повторить</button></div>';
  } finally { if (seq === _prospects.request) root.removeAttribute('aria-busy'); }
}

function prospectsClose() {
  ++_prospects.detailRequest; _prospects.current = null;
  document.getElementById('prospects-detail').hidden = true;
  document.getElementById('prospects-overview').hidden = false;
}
function prospectsField(key, value, options, area) {
  const id = 'prospect-field-' + key;
  let control;
  if (options) control = '<select id="' + id + '">' + prospectsOptions(options, value) + '</select>';
  else if (area) control = '<textarea id="' + id + '" rows="3" maxlength="5000">' + prospectsEscape(value) + '</textarea>';
  else control = '<input id="' + id + '" type="' + (key.endsWith('_date') ? 'date' : 'text') + '" maxlength="5000" value="' + prospectsEscape(value) + '">';
  return '<label class="prospect-field' + (area ? ' wide' : '') + '"><span>' + PROSPECT_LABELS[key] + '</span>' + control + '</label>';
}
async function prospectsOpen(id) {
  const seq = ++_prospects.detailRequest;
  const root = document.getElementById('prospects-detail');
  document.getElementById('prospects-overview').hidden = true; root.hidden = false;
  root.innerHTML = '<button class="btn btn-secondary" onclick="prospectsClose()">← К базе</button><div class="loading-block">Загружаем карточку…</div>';
  try {
    const r = await apiGet('/api/sales/prospects/' + encodeURIComponent(id));
    if (seq !== _prospects.detailRequest) return;
    _prospects.current = r;
    const source = r.source_data || {}, dict = _prospects.dict;
    if (!dict) throw new Error('Сначала загрузите список производств');
    const sources = ['source', 'email_source', 'phone_source', 'site_pages'].map(function (k) { return source[k] || ''; }).join(' ');
    const urls = [...new Set(sources.match(/https?:\/\/[^\s;|]+/g) || [])];
    root.innerHTML = '<button class="btn btn-secondary" onclick="prospectsClose()">← К базе</button>' +
      '<div class="prospect-detail-heading"><h2>' + prospectsEscape(r.name) + '</h2><p>' + prospectsEscape([r.segment, r.region, r.city].filter(Boolean).join(' · ')) + '</p><p>' + prospectsEscape(r.address || 'Адрес не найден') + '</p>' +
      (r.inn ? '<p>ИНН: ' + prospectsEscape(r.inn) + '</p>' : '') + '</div>' +
      '<div class="prospect-note">Предложение: разбор камеры созревания и подбор климата под сыр, помещение и загрузку.</div>' +
      '<form id="prospect-form" onsubmit="prospectsSave(event)"><fieldset' + (!canManageSales() ? ' disabled' : '') + '><div class="prospect-fields">' +
      prospectsField('stage', r.stage, dict.stages) + prospectsField('owner', r.owner) +
      prospectsField('qualification', r.qualification, PROSPECT_QUALIFICATIONS) + prospectsField('contact_person', r.contact_person) +
      prospectsField('contact_role', r.contact_role) + prospectsField('email', r.email) + prospectsField('phone', r.phone) + prospectsField('site', r.site) +
      prospectsField('need', r.need, null, true) + prospectsField('next_action', r.next_action) + prospectsField('next_date', r.next_date) +
      prospectsField('consent', r.consent, dict.consents) + prospectsField('consent_date', r.consent_date) +
      prospectsField('consent_basis', r.consent_basis, null, true) + prospectsField('comment', r.comment, null, true) + '</div>' +
      '<div class="prospect-save-row"><button class="btn btn-primary" type="submit" id="prospect-save">Сохранить карточку</button><span id="prospect-save-result" role="status"></span></div></fieldset></form>' +
      '<details class="prospect-source"><summary>Источники и исходные контакты</summary><dl>' +
      [['Проверка', source.verification], ['Дата сбора', prospectsDate(source.checked)], ['Исходный email', source.email_raw || source.email],
       ['Исходный телефон', source.phone_raw || source.phone], ['Email со страницы сайта', source.site_emails], ['Примечание', source.notes],
       ['Тип адреса', source.address_type || 'Как указан в источнике'], ['Период данных источника', source.origin_period || 'Не указан']].map(function (v) { return '<dt>' + v[0] + '</dt><dd>' + prospectsEscape(v[1] || '—') + '</dd>'; }).join('') +
      '</dl><div class="prospect-source-links">' + urls.map(prospectsLinks).join('<br>') + '</div></details>' +
      (r.contractors.length ? '<div class="prospect-source"><b>Контрагенты с тем же ИНН</b>' + r.contractors.map(function (c) { return '<p><button class="prospect-name" onclick="prospectsContractor(' + Number(c.id) + ')">' + prospectsEscape(c.name) + '</button> ' + prospectsEscape(c.address || '') + '</p>'; }).join('') + '</div>' : '') +
      '<details class="prospect-source"><summary>История изменений</summary>' + (r.events.length ? r.events.map(function (ev) {
        const changes = JSON.parse(ev.changes_json);
        return '<p><b>' + prospectsEscape(ev.created_at) + ' UTC</b><br>' + Object.keys(changes).map(function (key) {
          const value = changes[key].to;
          const label = key === 'stage' ? dict.stages[value] : key === 'consent' ? dict.consents[value] : key === 'qualification' ? PROSPECT_QUALIFICATIONS[value] : value;
          return prospectsEscape(PROSPECT_LABELS[key] || key) + ': ' + prospectsEscape(label || '—');
        }).join('<br>') + '</p>';
      }).join('') : '<p>Пока нет изменений</p>') + '</details>';
  } catch (e) { if (seq === _prospects.detailRequest) root.innerHTML = '<button class="btn btn-secondary" onclick="prospectsClose()">← К базе</button><p>' + prospectsEscape(e.message) + '</p>'; }
}
async function prospectsSave(event) {
  event.preventDefault(); if (!_prospects.current || !canManageSales()) return;
  const button = document.getElementById('prospect-save'), result = document.getElementById('prospect-save-result');
  const id = _prospects.current.id;
  const body = { revision: _prospects.current.revision };
  Object.keys(PROSPECT_LABELS).forEach(function (k) { body[k] = document.getElementById('prospect-field-' + k).value; });
  button.disabled = true; result.textContent = 'Сохраняем…';
  try {
    await apiPatch('/api/sales/prospects/' + encodeURIComponent(id), body);
    showToast('Карточка сохранена', 'success');
    await loadProspects();
    if (_prospects.current && _prospects.current.id === id) await prospectsOpen(id);
  } catch (e) { result.textContent = e.message || 'Не удалось сохранить'; button.disabled = false; }
}

function prospectsChooseImport(input) { _prospects.file = input.files[0] || null; _prospects.preview = false; document.getElementById('prospects-import-result').textContent = ''; document.getElementById('prospects-import-apply').hidden = true; }
function prospectsShowImport() {
  if (!canManageSales()) return;
  prospectsClose();
  document.getElementById('prospects-import-panel').hidden = false;
}
async function prospectsContractor(id) {
  try {
    const row = await apiGet('/api/contractors/' + id);
    cache.contractors = (cache.contractors || []).filter(function (c) { return c.id !== id; });
    cache.contractors.push(row);
    openContractor(id);
  } catch (e) { showToast(e.message || 'Не удалось открыть контрагента', 'error'); }
}
async function prospectsImport(preview) {
  const output = document.getElementById('prospects-import-result');
  const file = _prospects.file;
  if (!file || file.size > 5 * 1024 * 1024) { output.textContent = 'Выберите XLSX до 5 МБ'; return; }
  if (!preview && !_prospects.preview) return;
  const buttons = document.querySelectorAll('#prospects-import-panel button'); buttons.forEach(function (b) { b.disabled = true; });
  output.textContent = preview ? 'Проверяем файл…' : 'Загружаем базу…';
  try {
    const form = new FormData(); form.append('file', file);
    const token = localStorage.getItem(TOKEN_KEY);
    const response = await fetch(API_BASE + '/api/sales/prospects/import' + (preview ? '?preview=1' : ''), { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
    const r = await response.json(); if (!response.ok) throw new Error(r.message || 'Не удалось загрузить файл');
    if (_prospects.file !== file) return;
    _prospects.preview = preview;
    output.textContent = (preview ? 'Будет добавлено: ' : 'Добавлено: ') + r.added + '. Уже есть в базе: ' + r.skipped + '. Всего в файле: ' + r.received + '.';
    document.getElementById('prospects-import-apply').hidden = !preview || !r.added;
    if (!preview) { await loadProspects(); showToast('Импорт завершён', 'success'); }
  } catch (e) { _prospects.preview = false; document.getElementById('prospects-import-apply').hidden = true; output.textContent = e.message || 'Не удалось прочитать ответ сервера'; }
  finally { buttons.forEach(function (b) { b.disabled = false; }); }
}
