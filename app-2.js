// ============ КОНЕЦ ЭТАПА 14Б ============

// ============================================================================
// ============ ЭТАП 15: СВЯЗЬ СБОРОК С ДОГОВОРАМИ ===========================
// ============================================================================

cache.contractsForPicker = null;
cache.contractsWithProgress = null;

// --- Выбор «На склад / Под договор» в форме новой сборки ---

function setAssemblyDestination(dest) {
  // dest = 'warehouse' или 'contract'
  if (!state.newAssembly) return;
  if (dest === 'warehouse') {
    state.newAssembly.contractId = null;
    state.newAssembly.contractLabel = '';
    renderAssemblyDestination();
  } else {
    // Открываем модалку выбора договора
    openContractPickerModal();
  }
}

function renderAssemblyDestination() {
  // Обновляем визуальное состояние двух кнопок + показывает выбранный договор
  const dispEl = document.getElementById('na-destination-display');
  const warehouseBtn = document.querySelector('.dest-option[data-dest="warehouse"]');
  const contractBtn = document.querySelector('.dest-option[data-dest="contract"]');
  if (!warehouseBtn || !contractBtn) return;

  warehouseBtn.classList.remove('selected');
  contractBtn.classList.remove('selected');

  const cId = state.newAssembly ? state.newAssembly.contractId : null;
  if (cId) {
    contractBtn.classList.add('selected');
    // Показываем подсказку «Договор №X · Контрагент»
    if (dispEl) {
      dispEl.style.display = '';
      dispEl.innerHTML =
        '<div class="selected-contract-card" onclick="openContractPickerModal()">' +
          '<div class="scc-icon"><i class="ti ti-file-text"></i></div>' +
          '<div class="scc-body">' +
            '<div class="scc-num">' + escapeHtml(state.newAssembly.contractLabel || '—') + '</div>' +
            '<div class="scc-meta">Сборка пойдёт в счёт этого договора</div>' +
          '</div>' +
          '<span class="scc-change">сменить</span>' +
        '</div>';
    }
  } else {
    warehouseBtn.classList.add('selected');
    if (dispEl) {
      dispEl.style.display = 'none';
      dispEl.innerHTML = '';
    }
  }
}

// --- Модалка выбора договора ---

function openContractPickerModal() {
  // ЭТАП 16В-2: режим по умолчанию — assembly (старое поведение)
  state.contractPickerMode = 'assembly';
  _showContractPickerModal();
}

// ЭТАП 16В-2: открыть пикер в режиме выбора договора для задачи
function openContractPickerForTask() {
  state.contractPickerMode = 'task';
  _showContractPickerModal();
}

function _showContractPickerModal() {
  document.getElementById('contract-picker-modal').classList.add('visible');
  document.getElementById('contract-picker-search').value = '';
  // Скрываем кнопку "Без договора (на склад)" для режима task
  const wasteBtn = document.getElementById('contract-picker-skip');
  // «Без договора (на склад)» — только в режиме выбора назначения новой сборки
  if (wasteBtn) wasteBtn.style.display = (state.contractPickerMode === 'assembly') ? '' : 'none';
  loadContractsForPicker('');
  setTimeout(() => {
    const s = document.getElementById('contract-picker-search');
    if (s) s.focus();
  }, 100);
}

function closeContractPickerModal() {
  document.getElementById('contract-picker-modal').classList.remove('visible');
}

async function loadContractsForPicker(query) {
  const container = document.getElementById('contract-picker-body');
  container.innerHTML = '<div class="loading-block">Загружаем активные договоры…</div>';
  try {
    if (!cache.contractsForPicker) {
      const d = await apiGet('/api/contracts-for-picker');
      cache.contractsForPicker = d.contracts || [];
    }
    let list = cache.contractsForPicker;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(c =>
        (c.number || '').toLowerCase().includes(q) ||
        (c.contractor_name || '').toLowerCase().includes(q)
      );
    }
    if (!list.length) {
      container.innerHTML =
        '<div class="empty-block"><i class="ti ti-file-search"></i>' +
        (query
          ? 'Нет договоров по этому запросу'
          : 'Нет активных договоров в производстве.<br><br>Сборка пойдёт на склад.') +
        '</div>';
      return;
    }
    let html = '';
    list.forEach(c => {
      const deadlineHtml = formatContractDeadline(c.delivery_date);
      html += '<div class="modal-item" onclick="pickContract(' + c.id + ')">' +
        '<div class="mi-icon"><i class="ti ti-file-text"></i></div>' +
        '<div class="mi-text">' +
          '<div class="mi-title">' + escapeHtml(c.number) + ' · ' + escapeHtml(c.contractor_name || '—') + '</div>' +
          '<div class="mi-meta">' +
            escapeHtml(c.status_label || '—') +
            (c.manager_name ? ' · менеджер ' + escapeHtml(c.manager_name) : '') +
            (deadlineHtml ? ' · ' + deadlineHtml : '') +
          '</div>' +
        '</div></div>';
    });
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

// ЭТАП 16В-2: универсальный обработчик клика по договору в пикере.
// Роутит выбор в зависимости от режима.
function pickContract(contractId) {
  if (state.contractPickerMode === 'task') {
    pickTaskContract(contractId);
  } else if (state.contractPickerMode === 'assembly-reserve') {
    reserveAssemblyToContract(contractId);
  } else {
    pickAssemblyContract(contractId);
  }
}

// Назначить свободную сборку со склада в изделие (договор) → резерв
function openReserveAssemblyPicker(assemblyId) {
  state.reserveAssemblyId = assemblyId;
  state.contractPickerMode = 'assembly-reserve';
  _showContractPickerModal();
}

// Шаг 1: выбрали договор → подтягиваем его изделия (позиции) и даём выбрать
async function reserveAssemblyToContract(contractId) {
  if (!state.reserveAssemblyId) return;
  closeContractPickerModal();
  state.reserveContractId = contractId;
  let items = [];
  try {
    const d = await apiGet('/api/contracts/' + contractId + '/items-list');
    items = (d && d.items) || [];
  } catch (e) { items = []; }
  if (!items.length) {
    doReserveAssembly(contractId, null);   // нет позиций — под договор целиком
    return;
  }
  openReserveItemPicker(contractId, items);
}

function _fmtItemQty(it) {
  const q = (it.qty != null && it.qty !== '') ? it.qty : '';
  return q !== '' ? (q + ' ' + (it.unit || 'шт.')) : '';
}

// Шаг 2: выбор конкретного изделия (позиции) договора
function openReserveItemPicker(contractId, items) {
  let modal = document.getElementById('reserve-item-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'reserve-item-modal';
  modal.className = 'modal-overlay visible';
  modal.style.zIndex = '270';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  const rows = items.map(it =>
    '<div class="modal-item" onclick="doReserveAssembly(' + contractId + ',' + it.id + ')">' +
      '<div class="mi-icon"><i class="ti ti-package"></i></div>' +
      '<div class="mi-text">' +
        '<div class="mi-title">' + escapeHtml(it.name) + '</div>' +
        '<div class="mi-meta">' + escapeHtml(_fmtItemQty(it)) +
          (it.model_name ? ' · ' + escapeHtml(it.model_name) : '') + '</div>' +
      '</div></div>'
  ).join('');
  modal.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:560px;">' +
      '<div class="modal-header"><h3><i class="ti ti-package"></i> Выберите изделие</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'reserve-item-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content" style="max-height:62vh;overflow-y:auto;">' +
        rows +
        '<div class="modal-item" onclick="doReserveAssembly(' + contractId + ',0)" style="border-top:1px solid var(--border);margin-top:6px;">' +
          '<div class="mi-icon"><i class="ti ti-file-text"></i></div>' +
          '<div class="mi-text"><div class="mi-title">Весь заказ (без конкретного изделия)</div></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
}

async function doReserveAssembly(contractId, itemId) {
  const aid = state.reserveAssemblyId;
  const m = document.getElementById('reserve-item-modal');
  if (m) m.remove();
  if (!aid) return;
  try {
    const body = { contract_id: contractId };
    if (itemId) body.contract_item_id = itemId;
    const res = await apiPost('/api/assemblies/' + aid + '/reserve', body);
    if (!res.ok) throw new Error((res.data && res.data.message) || ('HTTP ' + res.status));
    showToast('Назначено — теперь в резерве', 'success');
    cache.warehouseStock = null;
    if (typeof openAssemblyStock === 'function') openAssemblyStock(aid);
    try { if (typeof loadWarehouseStock === 'function') loadWarehouseStock(); } catch (_) {}
  } catch (e) {
    showToast('Не удалось назначить: ' + (e.message || ''), 'error');
  }
}

async function unreserveAssembly(aid) {
  if (!confirm('Снять резерв и вернуть деталь в свободный остаток?')) return;
  try {
    const res = await apiPost('/api/assemblies/' + aid + '/unreserve', {});
    if (!res.ok) throw new Error((res.data && res.data.message) || ('HTTP ' + res.status));
    showToast('Резерв снят — деталь свободна', 'success');
    cache.warehouseStock = null;
    if (typeof openAssemblyStock === 'function') openAssemblyStock(aid);
    try { if (typeof loadWarehouseStock === 'function') loadWarehouseStock(); } catch (_) {}
  } catch (e) {
    showToast('Не удалось: ' + (e.message || ''), 'error');
  }
}

function pickAssemblyContract(contractId) {
  const c = (cache.contractsForPicker || []).find(x => x.id === contractId);
  if (!c) return;
  state.newAssembly.contractId = contractId;
  state.newAssembly.contractLabel =
    c.number + (c.contractor_name ? ' · ' + c.contractor_name : '');
  closeContractPickerModal();
  renderAssemblyDestination();
}

function pickAssemblyToWarehouse() {
  state.newAssembly.contractId = null;
  state.newAssembly.contractLabel = '';
  closeContractPickerModal();
  renderAssemblyDestination();
}

// ЭТАП 16В-2: выбор договора для формы задачи
function pickTaskContract(contractId) {
  const c = (cache.contractsForPicker || []).find(x => x.id === contractId);
  if (!c) return;
  state.taskForm.contract_id = contractId;
  state.taskForm.contract_label =
    c.number + (c.contractor_name ? ' · ' + c.contractor_name : '');
  if (typeof _saveTaskDraft === 'function') _saveTaskDraft();
  closeContractPickerModal();
  // Перерисуем форму, чтобы показать новое значение
  if (state.currentScreen === 'task-form') renderTaskForm();
}

// ЭТАП 16В-2: очистить привязку к договору в форме задачи
function clearTaskContract() {
  state.taskForm.contract_id = null;
  state.taskForm.contract_label = '';
  if (typeof _saveTaskDraft === 'function') _saveTaskDraft();
  if (state.currentScreen === 'task-form') renderTaskForm();
}

// --- Хелпер форматирования дедлайна договора ---

function formatContractDeadline(iso) {
  if (!iso) return '';
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const diff = Math.round((d - today) / (1000 * 60 * 60 * 24));
    if (diff < 0) return 'просрочен ' + Math.abs(diff) + ' дн.';
    if (diff === 0) return 'сегодня';
    if (diff === 1) return 'завтра';
    if (diff < 7) return 'через ' + diff + ' дн.';
    return 'до ' + formatDateLong(iso);
  } catch (e) {
    return '';
  }
}

// --- Главная Продаж: блок «Готовность договоров» ---

async function loadContractsProgressForSales() {
  // Менеджер видит все договоры (как договорились в Этапе 15 — пункт 4 ответа)
  try {
    const d = await apiGet('/api/contracts-with-progress');
    cache.contractsWithProgress = d.contracts || [];
    renderContractsProgressForSales();
  } catch (e) {
    // Тихо игнорируем — блок просто не появится
    cache.contractsWithProgress = [];
  }
}

function renderContractsProgressForSales() {
  // Этот блок вставляется в main контент Продаж дашборда
  const container = document.getElementById('sales-progress-block');
  if (!container) return;
  const list = cache.contractsWithProgress || [];
  if (!list.length) {
    container.innerHTML = '';
    return;
  }

  let html = '<div class="section-label" style="margin-top: 20px;">Готовность договоров в работе · ' + list.length + '</div>';
  html += '<div style="padding: 0 18px;">';
  list.forEach(c => {
    html += renderContractProgressCard(c);
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderContractProgressCard(c) {
  const qty = c.assemblies_qty || 0;
  // Прогресс-бар: пока не знаем сколько надо (расшифровка позиций будет в Этапе 16),
  // показываем просто прогресс по факту: 0 / есть.
  // Когда добавим расшифровку договора по позициям — посчитаем реальный %.
  const hasAssemblies = qty > 0;
  let fillCls = 'empty';
  let widthPct = 0;
  if (hasAssemblies) {
    fillCls = '';
    widthPct = 50; // условно «в процессе» — без знания плана точнее не показать
  }

  const deadlineHtml = c.delivery_date ? formatContractDeadline(c.delivery_date) : '';
  let deadlineCls = '';
  if (c.delivery_date) {
    try {
      const diff = Math.round((new Date(c.delivery_date) - new Date()) / (1000 * 60 * 60 * 24));
      if (diff <= 3 && diff >= 0) deadlineCls = ' soon';
      else if (diff < 0) deadlineCls = ' urgent';
    } catch (e) {}
  }

  // ЭТАП 38 (v2.18.0): класс срочности для подсветки border-left
  const urgCls = getContractUrgencyClass(c);

  return '<div class="contract-progress-card ' + urgCls + '" onclick="openContractDetail(' + c.id + ')">' +
    '<div class="cpc-body">' +
      '<div class="cpc-head">' +
        '<span class="cpc-num">' + escapeHtml(c.number) + '</span>' +
        (deadlineHtml ? '<span class="cpc-deadline' + deadlineCls + '">' + escapeHtml(deadlineHtml) + '</span>' : '') +
      '</div>' +
      '<div class="cpc-contractor">' + escapeHtml(c.contractor_name || '—') + '</div>' +
      '<div class="cpc-progress">' +
        '<div class="cpc-bar"><div class="cpc-bar-fill ' + fillCls + '" style="width: ' + widthPct + '%;"></div></div>' +
        '<span class="cpc-count">' + (hasAssemblies ? '<b>' + qty + '</b> ' + pluralAssemblies(qty) : 'нет сборок') + '</span>' +
      '</div>' +
    '</div></div>';
}

// ЭТАП 38 (v2.18.0): класс срочности договора для CSS-подсветки
// Возвращает один из: 'urg-overdue', 'urg-urgent', 'urg-soon', 'urg-ok', 'urg-nodate', 'urg-done'
function getContractUrgencyClass(c) {
  if (!c) return 'urg-nodate';
  const status = c.status || '';
  if (status === 'shipped' || status === 'closed') return 'urg-done';
  if (!c.delivery_date) return 'urg-nodate';
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(c.delivery_date + 'T00:00:00');
    if (isNaN(target.getTime())) return 'urg-nodate';
    const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'urg-overdue';   // просрочен
    if (diffDays <= 3) return 'urg-urgent';    // 0-3 дней — горит
    if (diffDays <= 10) return 'urg-soon';     // 4-10 — внимание
    return 'urg-ok';                            // >10 — спокойно
  } catch (e) {
    return 'urg-nodate';
  }
}

function pluralAssemblies(n) {
  const a = n % 10, b = n % 100;
  if (b >= 11 && b <= 14) return 'сборок';
  if (a === 1) return 'сборка';
  if (a >= 2 && a <= 4) return 'сборки';
  return 'сборок';
}

// ЭТАП 16А-2: шаблоны условий оплаты
const PAYMENT_TERMS_PRESETS = [
  '50% при подписании договора, 50% перед отгрузкой',
  '50% при изготовлении, 50% перед отгрузкой',
  '30% предоплата, 70% по готовности',
  '100% предоплата',
  'По факту отгрузки',
];

// ЭТАП 16А-2: рендер поля «Условия оплаты» с выпадашкой шаблонов
function renderPaymentTermsField(currentValue) {
  const v = currentValue || '';
  const isPreset = PAYMENT_TERMS_PRESETS.includes(v);
  // Если значение пустое или совпадает с шаблоном — показываем select
  // Если значение свой вариант — показываем textarea + кнопку "вернуть к шаблонам"
  let html = '<div class="sales-form-row cols-1"><div>';
  html += '<label>Условия оплаты</label>';
  if (!v || isPreset) {
    html += '<select id="sof-payment-terms-select" onchange="onPaymentTermsSelectChange(this.value)">';
    html += '<option value="">— не указано —</option>';
    PAYMENT_TERMS_PRESETS.forEach(p => {
      html += '<option value="' + escapeHtml(p) + '"' + (v === p ? ' selected' : '') + '>' + escapeHtml(p) + '</option>';
    });
    html += '<option value="__custom__">✏ Свой вариант…</option>';
    html += '</select>';
  } else {
    // Свой вариант — показываем textarea и кнопку «вернуть к шаблонам»
    html += '<textarea id="sof-payment-terms-input" rows="2" placeholder="Введите свой вариант">' + escapeHtml(v) + '</textarea>';
    html += '<button type="button" class="btn-link" onclick="resetPaymentTermsToPresets()" style="background:none; border:none; color:var(--brand); padding:6px 0; cursor:pointer; font-size:12px; text-align:left;">' +
            '<i class="ti ti-arrow-back-up"></i> Выбрать из шаблонов</button>';
  }
  html += '</div></div>';
  return html;
}

function onPaymentTermsSelectChange(value) {
  if (value === '__custom__') {
    // Переключаемся в режим свободного ввода
    state.offerForm.payment_terms = state.offerForm.payment_terms || ' ';
    renderOfferForm();
    // Фокус в textarea
    setTimeout(() => {
      const ta = document.getElementById('sof-payment-terms-input');
      if (ta) { ta.value = ''; ta.focus(); state.offerForm.payment_terms = ''; }
    }, 50);
    return;
  }
  state.offerForm.payment_terms = value;
}

function resetPaymentTermsToPresets() {
  state.offerForm.payment_terms = '';
  renderOfferForm();
}

// ЭТАП 16А: человекочитаемое «14 дней / 2 недели / 1 месяц»
function validDurationLabel(value, unit) {
  const v = parseInt(value) || 0;
  if (v <= 0) return '';
  const a = v % 10, b = v % 100;
  if (unit === 'weeks') {
    if (b >= 11 && b <= 14) return v + ' недель';
    if (a === 1) return v + ' неделя';
    if (a >= 2 && a <= 4) return v + ' недели';
    return v + ' недель';
  }
  if (unit === 'months') {
    if (b >= 11 && b <= 14) return v + ' месяцев';
    if (a === 1) return v + ' месяц';
    if (a >= 2 && a <= 4) return v + ' месяца';
    return v + ' месяцев';
  }
  // days
  if (b >= 11 && b <= 14) return v + ' дней';
  if (a === 1) return v + ' день';
  if (a >= 2 && a <= 4) return v + ' дня';
  return v + ' дней';
}

// ЭТАП 16А-2: «20 рабочих дней» / «1 рабочий день»
function productionDaysLabel(days) {
  const v = parseInt(days) || 0;
  if (v <= 0) return '';
  const a = v % 10, b = v % 100;
  if (b >= 11 && b <= 14) return v + ' рабочих дней';
  if (a === 1) return v + ' рабочий день';
  if (a >= 2 && a <= 4) return v + ' рабочих дня';
  return v + ' рабочих дней';
}

function openContractDetail(contractId) {
  state.currentContractId = contractId;
  selectSidebarItem('sales-contract-detail');
}

// --- Главная Производства: блок «Текущие договоры в работе» ---

async function loadContractsProgressForProduction() {
  try {
    const d = await apiGet('/api/contracts-with-progress');
    cache.contractsWithProgress = d.contracts || [];
    renderContractsProgressForProduction();
  } catch (e) {
    cache.contractsWithProgress = [];
  }
}

function renderContractsProgressForProduction() {
  const container = document.getElementById('production-contracts-block');
  if (!container) return;
  // Показываем только те где есть deadline, либо где уже что-то собрано
  const list = (cache.contractsWithProgress || []);
  if (!list.length) {
    container.innerHTML = '';
    return;
  }

  let html = '<div class="section-label" style="margin-top: 20px;">Договоры в работе · ' + list.length + '</div>';
  html += '<div style="padding: 0 18px;">';
  list.forEach(c => {
    html += renderContractProgressCard(c);
  });
  html += '</div>';
  container.innerHTML = html;
}

// --- Карточка договора: блок «Сборки под этот договор» ---

function renderContractAssembliesBlock(c) {
  // Вызывается из renderContractDetail (вставляется в нужное место)
  const assemblies = c.assemblies || [];

  // v2.43.16: считаем по статусам отдельно, чтобы не валить in_progress в «собрано»
  let qtyReady = 0, qtyInProgress = 0, qtyShipped = 0;
  assemblies.forEach(a => {
    const q = Number(a.quantity || 0);
    if (a.status === 'in_progress') qtyInProgress += q;
    else if (a.status === 'shipped') qtyShipped += q;
    else if (a.status === 'ready') qtyReady += q;
  });
  const qtyDoneTotal = qtyReady + qtyShipped; // готовые на складе + уже отгруженные

  // v2.45.133: покупные комплектующие в резерве — НЕ сборки, считаем отдельно,
  // чтобы плашка «Готово на складе» показывала полную картину (сборки + покупное)
  // и цифра «N сборок» не путалась с числом зелёных бейджей «В резерве» в спецификации.
  const _specEarly = (state._specByContract && state._specByContract[c.id]) || {};
  const _itemsEarly = (_specEarly.items && _specEarly.items.length) ? _specEarly.items : (c.items || []);
  const _reservedComps = _itemsEarly.filter(it =>
    it && it.component_id && !it.model_id && Number(it.qty_reserved || 0) > 0
  );
  const _reservedQtySum = _reservedComps.reduce((acc, it) =>
    acc + Math.max(1, Math.floor(Number(it.qty || it.qty_reserved || 1))), 0);

  let html = '';
  html += '<div class="section-label" style="margin-top: 20px;">Готовность по сборкам</div>';
  html += '<div style="padding: 0 18px;font-size:12px;color:var(--text-light);margin-bottom:6px;">' +
    'Что собираем на производстве по этому договору — сборки и узлы (ЩУ, узлы регулирования и т.п.) и их готовность.</div>';
  html += '<div style="padding: 0 18px 16px;">';

  // v2.43.13: контейнер прогресс-бара (заполняется renderContractProgressBar
  // после loadContractItemsBlock)
  html += '<div id="scd-progress-block" style="margin-bottom: 12px;"></div>';

  // v2.43.16: две плашки — «Готово» и «В работе» — рядом
  html += '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom: 12px;">';
  // Готово
  html += '<div style="background: #ECFDF5; padding: 14px 16px; border-radius: 10px; display:flex; justify-content:space-between; align-items:center; border:1px solid #A7F3D0;">' +
    '<div>' +
      '<div style="font-size: 11px; color: #047857; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600;">ГОТОВО НА СКЛАДЕ</div>' +
      '<div style="font-size: 22px; font-weight: 700; color: #065F46; margin-top: 2px;">' + qtyDoneTotal + ' ' + pluralAssemblies(qtyDoneTotal) +
        (qtyShipped > 0 ? ' <span style="font-size:11px; color:#059669; font-weight:600;">· ' + qtyShipped + ' отгруж.</span>' : '') +
      '</div>' +
      // v2.45.133: покупные в резерве — отдельной строкой, чтобы было видно полную готовность
      (_reservedQtySum > 0
        ? '<div style="font-size: 11.5px; color: #047857; margin-top: 3px;">+ ' + _reservedQtySum + ' ' +
            _plural(_reservedQtySum, ['покупное', 'покупных', 'покупных']) + ' в резерве</div>'
        : '') +
    '</div>' +
    '<i class="ti ti-package-import" style="font-size: 32px; color: #10B981; opacity: 0.6;"></i>' +
    '</div>';
  // В работе
  html += '<div style="background: #EFF6FF; padding: 14px 16px; border-radius: 10px; display:flex; justify-content:space-between; align-items:center; border:1px solid #BFDBFE;">' +
    '<div>' +
      '<div style="font-size: 11px; color: #1D4ED8; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600;">В РАБОТЕ СЕЙЧАС</div>' +
      '<div style="font-size: 22px; font-weight: 700; color: #1E3A8A; margin-top: 2px;">' + qtyInProgress + ' ' + pluralAssemblies(qtyInProgress) + '</div>' +
    '</div>' +
    '<i class="ti ti-tool" style="font-size: 32px; color: #3B82F6; opacity: 0.6;"></i>' +
    '</div>';
  html += '</div>';

  // ЭТАП 18: кнопка отгрузки по договору (если есть готовые сборки)
  // Считаем сколько сборок имеет потенциальный шанс быть отгруженными
  const readyCount = (c.assemblies || []).filter(a => a.status === 'ready').length;
  const canShip = canManageSales();
  if (readyCount > 0 && canShip) {
    html += '<div style="margin-bottom: 14px;">' +
      '<button class="btn btn-primary" onclick="shipByContract(' + c.id + ')" style="width: 100%; justify-content: center;">' +
        '<i class="ti ti-truck-delivery"></i> Отгрузить по договору (готово ' + readyCount + ')' +
      '</button>' +
      '</div>';
  }
  // v2.45.93: пакетная печать QR-наклеек на все готовые сборки договора
  // v2.45.95/99/100: + component-позиции в резерве тоже получают этикетку
  // v2.45.133: _reservedComps/_reservedQtySum уже посчитаны выше (для плашки готовности)
  const canPrint = (typeof canPrintLabels === 'function') && canPrintLabels();
  const totalQrCount = readyCount + _reservedQtySum;
  if (totalQrCount > 0 && canPrint) {
    let labelParts = [];
    if (readyCount > 0) labelParts.push(readyCount + ' сбор.');
    if (_reservedQtySum > 0) labelParts.push(_reservedQtySum + ' компл.');
    html += '<div style="margin-bottom: 14px;">' +
      '<button class="btn btn-secondary" onclick="batchPrintContractQrs(' + c.id + ')" ' +
        'style="width:100%;justify-content:center;border-color:#0C4A6E;color:#0C4A6E;background:#F0F9FF;">' +
        '<i class="ti ti-printer"></i> 🖨 Печать QR на все (' + totalQrCount + ': ' + labelParts.join(' · ') + ')' +
      '</button>' +
      '</div>';
  }

  if (assemblies.length) {
    html += '<div class="contract-assemblies-list">';
    if (state.isDesktop) {
      // Заголовок для десктопа
      html += '<div class="cal-row" style="background: #F8F9FB; border-top: none; font-size: 11px; color: var(--text-light); text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600;">' +
        '<div>Дата</div><div>Модель</div><div style="text-align: right;">Кол-во</div><div style="text-align: right;">Сборщики</div>' +
        '</div>';
    }
    assemblies.forEach(a => {
      const workers = (a.workers || []).map(w => w.short_name).filter(Boolean).join(', ') || '—';
      const modelFull = (a.model_name || '') + (a.model_extra ? ' · ' + a.model_extra : '');
      const ipExec = [];
      if (a.execution) ipExec.push(a.execution === 'st' ? (a.exec_label_st || 'Ст.') : (a.exec_label_ne || 'Нерж.'));
      if (a.ip_class) ipExec.push(a.ip_class);
      // v2.43.16: цветной бейдж статуса assembly
      let statusBadge = '';
      if (a.status === 'in_progress') {
        statusBadge = '<span class="a-status-badge a-st-inprog"><i class="ti ti-tool"></i>В работе</span>';
      } else if (a.status === 'ready') {
        statusBadge = '<span class="a-status-badge a-st-ready"><i class="ti ti-circle-check"></i>Готово</span>';
      } else if (a.status === 'shipped') {
        statusBadge = '<span class="a-status-badge a-st-shipped"><i class="ti ti-truck-delivery"></i>Отгружено</span>';
      }
      // v2.43.16: кнопки управления статусом сборки
      //   ready / shipped — нет кнопок (всё ок)
      //   in_progress     — кнопка ✓ «Готово» (переводит ready)
      //   ready (не shipped) — кнопка ↩ «Вернуть в работу» (для случая ошибки)
      // v2.43.17: парная кнопка + жёсткая перезагрузка спецификации
      // v2.45.313: имя сборщика усекается, кнопки управления НЕ сжимаются
      // (раньше 🗑 уезжала за край узкой колонки — нельзя было удалить сборку)
      let workersCellHtml = '<span class="cal-workers-name">' + escapeHtml(workers) + '</span>';
      if (canShip) {
        if (a.status === 'in_progress') {
          workersCellHtml +=
            ' <button class="cal-finish-btn" title="Сборка готова (перевести на склад)" ' +
                    'onclick="markAssemblyReady(' + a.id + ',' + c.id + ')">' +
              '<i class="ti ti-check"></i>' +
            '</button>';
        } else if (a.status === 'ready') {
          workersCellHtml +=
            ' <button class="cal-reopen-btn" title="Ошиблись? Вернуть в работу (отменить готовность)" ' +
                    'onclick="reopenAssembly(' + a.id + ',' + c.id + ')">' +
              '<i class="ti ti-arrow-back-up"></i>' +
            '</button>';
        }
        // v2.45.20: кнопка удаления сборки (для случаев когда сборка создана
        // ошибочно или больше не нужна, как у позиции 203 LUN после авто-привязки
        // к component на складе)
        if (a.status === 'in_progress' || a.status === 'ready') {
          workersCellHtml +=
            ' <button class="cal-delete-btn" title="Удалить сборку безвозвратно" ' +
                    'onclick="deleteAssemblyFromContract(' + a.id + ',' + c.id + ',\'' + escapeHtml(modelFull).replace(/'/g, "\\'") + '\')">' +
              '<i class="ti ti-trash"></i>' +
            '</button>';
        }
      }
      html += '<div class="cal-row">' +
        '<div class="cal-date">' + formatDateShort(a.assembly_date) + '</div>' +
        '<div class="cal-name">' + escapeHtml(modelFull) +
          ' ' + statusBadge +
          (ipExec.length ? '<small>' + escapeHtml(ipExec.join(' · ')) + '</small>' : '') +
        '</div>' +
        '<div class="cal-qty">' + a.quantity + ' шт.</div>' +
        '<div class="cal-workers">' + workersCellHtml + '</div>' +
        '</div>';
    });
    html += '</div>';
  } else {
    html += '<div class="contract-assemblies-list">' +
      '<div class="cal-empty"><i class="ti ti-package-off" style="font-size: 28px; color: var(--text-faint); display: block; margin-bottom: 6px;"></i>' +
      'Под этот договор сборок ещё нет<br><span style="font-size: 11.5px;">Они появятся когда мастер внесёт сборку и выберет этот договор</span>' +
      '</div></div>';
  }

  html += '</div>';
  return html;
}

// --- Хелпер форматирования даты «13.05» ---

function formatDateShort(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '.' + mm;
  } catch (e) {
    return iso;
  }
}

// ============ КОНЕЦ ЭТАПА 15 ============

// ============================================================================
// ============ ЭТАП 16Б: ГЛАВНАЯ — KPI / КУРС ВАЛЮТ / КАЛЬКУЛЯТОР ============
// ============================================================================

cache.homeKpi = null;        // {kpi:{...}, user_roles:[...]}
cache.cbrRates = null;       // {date, rates:{USD:{value,prev,diff}, EUR:{...}, CNY:{...}}, is_stale}

state.calc = {
  mode: 'math',              // 'math' | 'vat' | 'fx'
  // Математика
  mathDisplay: '0',
  mathExpr: '',
  mathPrev: null,
  mathOp: null,
  mathReset: false,           // флаг: следующая цифра обнулит дисплей
  // НДС
  vatRate: 22,
  vatMode: 'add',             // 'add' = из суммы без НДС, 'extract' = из суммы с НДС
  vatInput: '',
  // Валюты
  fxFromValue: '',
  fxFromCurrency: 'USD',
  fxToCurrency: 'RUB',
};

state.calcExpanded = false;

// ---------- Главная: загрузка и рендер ----------

async function loadHomeDashboard() {
  // Параллельно — KPI, курс, мои задачи, отгрузки, активности. Калькулятор не нуждается в API.
  const container = document.getElementById('home-content');
  // Сначала рендерим скелет (приветствие + плейсхолдеры)
  renderHomeSkeleton();
  // Дальше — независимые загрузки
  loadHomeKpi();
  loadCbrRates();
  loadHomeMyTasks();      // ЭТАП 16В
  loadHomeShipments();    // ЭТАП 16Г
  loadHomeContractsProgress(); // ЭТАП 31.4
  loadHomeDashboardExtras();   // v2.43.98: воронка / алерты / ТОП сборщиков
  // v2.8.2: лента «Последние действия» — только для директора
  if (state.user && (state.user.roles || []).includes('director')) {
    loadHomeActivity();
  }
  // loadHomeVacations() — отключено в v25.0 (блок убран с Главной)
}

function renderHomeSkeleton() {
  // Заголовок-приветствие
  // ПРАВКА: вместо фамилии (1-е слово) — имя+отчество (2-е и 3-е слова)
  const fullName = state.user && (state.user.full_name || state.user.short_name || '') || '';
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  let greetName = '';
  if (parts.length >= 3) {
    greetName = parts[1] + ' ' + parts[2];        // "Дмитрий Сергеевич"
  } else if (parts.length === 2) {
    greetName = parts[1];                          // только имя
  } else if (parts.length === 1) {
    greetName = parts[0];                          // как было
  }
  const greetEl = document.getElementById('home-greeting-name');
  const dateEl = document.getElementById('home-greeting-date');
  const greetMobEl = document.getElementById('home-greeting-name-mob');
  const dateMobEl = document.getElementById('home-greeting-date-mob');
  if (greetEl) greetEl.textContent = greetName ? ('Здравствуйте, ' + escapeText(greetName) + '!') : 'Здравствуйте!';
  if (greetMobEl) greetMobEl.textContent = greetEl ? greetEl.textContent : 'Здравствуйте!';
  const dateStr = todayHumanRu();
  if (dateEl) dateEl.textContent = 'Сегодня — ' + dateStr;
  if (dateMobEl) dateMobEl.textContent = 'Сегодня — ' + dateStr;

  const container = document.getElementById('home-content');
  if (!container) return;
  let html = '';

  // v2.43.77: радио переехало в левый сайдбар (пункт «Радио»), открывается модалкой.

  // ============ ЭТАП 25.0: блоки только для мобилки ============
  // Они показываются ТОЛЬКО когда .app.mobile-layout (через inline CSS у обёртки)
  html += '<div class="m25-mobile-only" style="margin: 0 -18px 0;">';
  // Недельный календарь
  html += '<div class="week-cal25">';
  html += '<div class="week-cal25-head">';
  html += '<div class="week-cal25-month"><i class="ti ti-calendar"></i><span id="week-cal25-month-label">—</span></div>';
  html += '<a class="week-cal25-link" onclick="selectSidebarItem(\'home-calendar\')">Открыть →</a>';
  html += '</div>';
  html += '<div class="week-cal25-grid" id="week-cal25-grid"></div>';
  html += '</div>';
  // Быстрые действия
  html += '<div class="qa25-section-label">Быстрые действия</div>';
  html += '<div class="qa25-grid" id="home25-quick-actions"></div>';
  html += '</div>';
  // ============ КОНЕЦ ЭТАПА 25.0 ============

  // v2.43.98: KPI «Сегодня» — sticky-обёртка, цифры всегда перед глазами при скролле
  html += '<div class="home-kpi-sticky">';
  html += '<div class="home-kpi-title"><i class="ti ti-calendar-stats"></i>Сегодня</div>';
  html += '<div id="home-kpi-block"><div class="loading-block" style="padding: 14px;">Загружаем показатели…</div></div>';
  html += '</div>';

  // v2.45.31: виджет «Калькулятор холода» переехал в левый сайдбар (пункт «Калькулятор холода»)
  // на главной больше не показываем.

  // v2.43.98: Воронка производства — пять стадий с цифрами
  html += '<div class="home-kpi-title" style="margin-top: 16px;"><i class="ti ti-stairs-up"></i>Воронка производства</div>';
  html += '<div id="home-funnel-block"><div class="loading-block" style="padding: 14px;">Загружаем…</div></div>';

  // v2.43.98: Алерты (только директор/мастер/зам)
  const _hasManage = (typeof hasPermission === 'function') && hasPermission('production.manage');
  if (_hasManage) {
    html += '<div class="home-kpi-title" style="margin-top: 16px;"><i class="ti ti-alert-triangle"></i>Алерты</div>';
    html += '<div id="home-alerts-block"><div class="loading-block" style="padding: 14px;">Загружаем…</div></div>';
  }

  // v2.43.98: ТОП сборщиков за неделю
  html += '<div class="home-kpi-title" style="margin-top: 16px;"><i class="ti ti-trophy"></i>ТОП сборщиков за неделю</div>';
  html += '<div id="home-top-assemblers-block"><div class="loading-block" style="padding: 14px;">Загружаем…</div></div>';

  // ЭТАП 16В: «Мои задачи»
  html += '<div class="home-kpi-title" style="margin-top: 16px;"><i class="ti ti-checklist"></i>Мои задачи</div>';
  html += '<div id="home-tasks-block"><div class="loading-block" style="padding: 14px;">Загружаем…</div></div>';

  // ЭТАП 16Г: «Ближайшие отгрузки»
  html += '<div class="home-kpi-title" id="home-shipments-title" style="margin-top: 16px;"><i class="ti ti-truck-delivery"></i>Ближайшие отгрузки</div>';
  html += '<div id="home-shipments-block"><div class="loading-block" style="padding: 14px;">Загружаем…</div></div>';

  // ЭТАП 31.4: «Договоры в работе» — переехало сюда с главной Производства
  html += '<div class="home-kpi-title" style="margin-top: 16px;"><i class="ti ti-briefcase"></i>Договоры в работе</div>';
  html += '<div id="home-contracts-progress-block"><div class="loading-block" style="padding: 14px;">Загружаем…</div></div>';

  // Курс валют placeholder
  html += '<div class="home-kpi-title" style="margin-top: 16px;"><i class="ti ti-currency-ruble"></i>Курсы ЦБ РФ</div>';
  html += '<div id="home-cbr-block"><div class="loading-block" style="padding: 14px;">Загружаем курс валют…</div></div>';

  // ЭТАП 16Г: «Последние действия» — только для директора (v2.8.2)
  const _isDirector = state.user && (state.user.roles || []).includes('director');
  if (_isDirector) {
    html += '<div class="home-kpi-title" style="margin-top: 16px;"><i class="ti ti-history"></i>Последние действия</div>';
    html += '<div id="home-activity-block"><div class="loading-block" style="padding: 14px;">Загружаем…</div></div>';
  }

  container.innerHTML = html;

  // ЭТАП 25.0: рендер новых мобильных блоков
  renderQuickActions25();
  renderWeekCal25();
  loadHomeWeekEvents();
  // v2.43.77: радио живёт в сайдбаре — обновим состояние кнопки
  renderSidebarRadio();
}

function escapeText(s) {
  return escapeHtml(String(s || ''));
}

// ============================================================
// ============ ЭТАП 20: МИНИ-КАЛЕНДАРЬ + БОЛЬШОЙ КАЛЕНДАРЬ ============
// ============================================================

state.bigCalMonth = null;  // {year, month} — текущий просматриваемый месяц
cache.bigCalEvents = null; // события для текущего просматриваемого месяца
cache.homeVacations = null;

const MONTH_NAMES_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                        'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTH_GENITIVE = ['января','февраля','марта','апреля','мая','июня',
                        'июля','августа','сентября','октября','ноября','декабря'];
const DOW_NAMES_SHORT = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function isoDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()); }

// ---- Мини-календарь в сайдбаре ----
function renderSidebarMiniCalendar() {
  const wrap = document.getElementById('sb-minical-wrap');
  if (!wrap) return;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11
  const today = now.getDate();

  // Первый день месяца, день недели (понедельник = 0)
  const firstOfMonth = new Date(year, month, 1);
  let firstDow = firstOfMonth.getDay() - 1; // вс=0 → -1, пн=1 → 0
  if (firstDow < 0) firstDow = 6;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  let html = '<div class="sb-minical-month">' + MONTH_NAMES_RU[month] + ' ' + year + '</div>';
  html += '<div class="sb-minical-grid">';
  // Заголовки дней недели
  DOW_NAMES_SHORT.forEach(d => {
    html += '<div class="sb-minical-dow">' + d + '</div>';
  });
  // Дни предыдущего месяца (из их хвоста)
  for (let i = firstDow - 1; i >= 0; i--) {
    html += '<div class="sb-minical-day is-outside">' + (daysInPrevMonth - i) + '</div>';
  }
  // Дни текущего месяца
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = (firstDow + d - 1) % 7;
    const cls = ['sb-minical-day'];
    if (d === today) cls.push('is-today');
    else if (dow >= 5) cls.push('is-weekend');
    html += '<div class="' + cls.join(' ') + '">' + d + '</div>';
  }
  // Заполнение пустых клеток после последнего дня (до 6 рядов = 42 клеток)
  const totalShown = firstDow + daysInMonth;
  const trailing = (totalShown % 7 === 0) ? 0 : (7 - (totalShown % 7));
  for (let i = 1; i <= trailing; i++) {
    html += '<div class="sb-minical-day is-outside">' + i + '</div>';
  }
  html += '</div>';
  wrap.innerHTML = html;
}

function openBigCalendarFromMini() {
  const now = new Date();
  state.bigCalMonth = { year: now.getFullYear(), month: now.getMonth() };
  selectSidebarItem('home-calendar');
}

// ---- Большой календарь ----
async function loadBigCalendar() {
  if (!state.bigCalMonth) {
    const now = new Date();
    state.bigCalMonth = { year: now.getFullYear(), month: now.getMonth() };
  }
  const { year, month } = state.bigCalMonth;
  const titleEl = document.getElementById('cal-title');
  if (titleEl) titleEl.textContent = MONTH_NAMES_RU[month] + ' ' + year;
  // Окно дат для запроса событий: на 6 строк (42 дня)
  const firstOfMonth = new Date(year, month, 1);
  let firstDow = firstOfMonth.getDay() - 1;
  if (firstDow < 0) firstDow = 6;
  const gridStart = new Date(year, month, 1 - firstDow);
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridEnd.getDate() + 41);
  const dateFrom = isoDate(gridStart);
  const dateTo   = isoDate(gridEnd);

  // Параллельная загрузка событий
  let events = { tasks: [], shipments: [], supplyOrders: [], vacations: [] };
  try {
    const [tRes, sRes, oRes, vRes] = await Promise.allSettled([
      apiGet('/api/tasks?status=open'),
      apiGet('/api/contracts?status=production'),
      apiGet('/api/supply-orders?status=open'),
      apiGet('/api/vacations?date_from=' + dateFrom + '&date_to=' + dateTo),
    ]);
    if (tRes.status === 'fulfilled') events.tasks = (tRes.value.tasks || []).filter(t => t.deadline);
    if (sRes.status === 'fulfilled') events.shipments = (sRes.value.contracts || []).filter(c => c.delivery_date);
    if (oRes.status === 'fulfilled') events.supplyOrders = (oRes.value.orders || []).filter(o => o.expected_date);
    if (vRes.status === 'fulfilled') events.vacations = vRes.value.vacations || [];
  } catch (e) {
    console.error('Big calendar load:', e);
  }
  cache.bigCalEvents = events;
  renderBigCalendar();
}

function renderBigCalendar() {
  const el = document.getElementById('big-cal-body');
  if (!el) return;
  const { year, month } = state.bigCalMonth;
  const firstOfMonth = new Date(year, month, 1);
  let firstDow = firstOfMonth.getDay() - 1;
  if (firstDow < 0) firstDow = 6;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const gridStart = new Date(year, month, 1 - firstDow);
  const today = new Date();
  const todayIso = isoDate(today);

  // Группируем события по дате
  const evByDate = {}; // iso → [{type, title, ...}]
  function addEv(iso, type, title, eventId) {
    if (!evByDate[iso]) evByDate[iso] = [];
    evByDate[iso].push({ type, title, eventId });
  }
  const ev = cache.bigCalEvents || { tasks: [], shipments: [], supplyOrders: [], vacations: [] };
  (ev.tasks || []).forEach(t => addEv(t.deadline, 'task', t.title || 'Задача', t.id));
  (ev.shipments || []).forEach(c => {
    const label = 'Отгрузка ' + (c.number || '#' + c.id) + (c.contractor_name ? ' · ' + c.contractor_name : '');
    addEv(c.delivery_date, 'shipment', label, c.id);
  });
  (ev.supplyOrders || []).forEach(o => {
    addEv(o.expected_date, 'supply', 'Приёмка #' + o.id + (o.supplier_name ? ' · ' + o.supplier_name : ''), o.id);
  });
  // Отпуска — растянутые на диапазон, проставляем на каждый день
  (ev.vacations || []).forEach(v => {
    const s = new Date(v.start_date);
    const e = new Date(v.end_date);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const iso = isoDate(d);
      addEv(iso, 'vacation', (v.employee_short_name || v.employee_full_name || 'Отпуск') + ' в отпуске', v.id);
    }
  });

  // v2.43.66: сохраняем события по датам для модалки дня
  state.bigCalEvByDate = evByDate;

  let html = '<div class="bigcal">';
  html += '<div class="bigcal-grid">';
  DOW_NAMES_SHORT.forEach(d => html += '<div class="bigcal-dow">' + d + '</div>');
  // 6 строк по 7 дней = 42 клетки
  const cell = new Date(gridStart);
  for (let i = 0; i < 42; i++) {
    const iso = isoDate(cell);
    const dayNum = cell.getDate();
    const dow = (i % 7);
    const isOutside = cell.getMonth() !== month;
    const isToday = iso === todayIso;
    const isWeekend = dow >= 5;
    const evs = evByDate[iso] || [];
    const cls = ['bigcal-day'];
    if (isOutside) cls.push('is-outside');
    if (isToday) cls.push('is-today');
    if (isWeekend) cls.push('is-weekend');
    if (evs.length) cls.push('has-events');
    // v2.43.66: клик по дню → карточка дня (если есть события)
    const clickAttr = evs.length ? ' onclick="openCalDayModal(\'' + iso + '\')"' : '';
    html += '<div class="' + cls.join(' ') + '"' + clickAttr + '>';
    html += '<div class="bigcal-day-num">' + dayNum + '</div>';
    // Десктоп: текстовые плашки. Мобильная: точки-индикаторы (через CSS).
    const maxShow = 3;
    if (evs.length) {
      // Текстовые плашки (видны на десктопе)
      html += '<div class="bigcal-events-text">';
      evs.slice(0, maxShow).forEach(e => {
        html += '<div class="bigcal-event ev-' + e.type + '" title="' + escapeHtml(e.title) + '">' + escapeHtml(e.title) + '</div>';
      });
      if (evs.length > maxShow) {
        html += '<div class="bigcal-day-more">+ ещё ' + (evs.length - maxShow) + '</div>';
      }
      html += '</div>';
      // Точки-индикаторы (видны на мобильной) — по уникальным типам
      const types = [...new Set(evs.map(e => e.type))];
      html += '<div class="bigcal-dots">';
      types.forEach(t => { html += '<span class="bigcal-dot ev-' + t + '"></span>'; });
      html += '</div>';
    }
    html += '</div>';
    cell.setDate(cell.getDate() + 1);
  }
  html += '</div></div>';

  // Легенда
  html += '<div style="display: flex; gap: 16px; padding: 12px 4px 0; flex-wrap: wrap; font-size: 12px; color: var(--text-light);">';
  html += '<span><span style="display:inline-block;width:10px;height:10px;background:#FFF4E6;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>задачи</span>';
  html += '<span><span style="display:inline-block;width:10px;height:10px;background:#DCEEFF;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>отгрузки</span>';
  html += '<span><span style="display:inline-block;width:10px;height:10px;background:#E8F5E9;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>приёмки</span>';
  html += '<span><span style="display:inline-block;width:10px;height:10px;background:#F3E8FF;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>отпуска</span>';
  html += '</div>';

  el.innerHTML = html;
}

// v2.43.66: карточка событий дня — открывается по клику на день календаря
function openCalDayModal(iso) {
  const evs = (state.bigCalEvByDate && state.bigCalEvByDate[iso]) || [];
  if (!evs.length) return;
  let modal = document.getElementById('cal-day-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'cal-day-modal';
  modal.className = 'modal-overlay visible';
  modal.style.zIndex = '300';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  // Заголовок — дата по-русски
  let dateLabel = iso;
  try {
    const d = new Date(iso + 'T00:00:00');
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    const dows = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
    dateLabel = d.getDate() + ' ' + months[d.getMonth()] + ', ' + dows[d.getDay()];
  } catch (e) {}

  const typeMeta = {
    task:     { icon: 'ti-checklist',     label: 'Задача',  cls: 'ev-task' },
    shipment: { icon: 'ti-truck-delivery',label: 'Отгрузка',cls: 'ev-shipment' },
    supply:   { icon: 'ti-package-import',label: 'Приёмка', cls: 'ev-supply' },
    vacation: { icon: 'ti-beach',         label: 'Отпуск',  cls: 'ev-vacation' },
  };

  let html = '<div class="modal" onclick="event.stopPropagation()" style="max-width:440px;">';
  html += '<div class="modal-header">';
  html += '<h3><i class="ti ti-calendar-event"></i> ' + escapeHtml(dateLabel) + '</h3>';
  html += '<button class="icon-btn" onclick="document.getElementById(\'cal-day-modal\').remove()"><i class="ti ti-x"></i></button>';
  html += '</div>';
  html += '<div class="modal-body" style="padding:12px 16px 18px; max-height:70vh; overflow-y:auto;">';
  evs.forEach(e => {
    const m = typeMeta[e.type] || { icon: 'ti-circle', label: '', cls: '' };
    // Навигация по типу
    let onClick = '';
    if (e.type === 'shipment' && e.eventId) onClick = 'onclick="document.getElementById(\'cal-day-modal\').remove();openContractDetail(' + e.eventId + ')"';
    else if (e.type === 'task' && e.eventId) onClick = 'onclick="document.getElementById(\'cal-day-modal\').remove();openTaskDetail&&openTaskDetail(' + e.eventId + ')"';
    html += '<div class="cal-day-item ' + m.cls + '" ' + onClick + '>' +
              '<div class="cal-day-item-icon"><i class="ti ' + m.icon + '"></i></div>' +
              '<div class="cal-day-item-body">' +
                '<div class="cal-day-item-type">' + m.label + '</div>' +
                '<div class="cal-day-item-title">' + escapeHtml(e.title) + '</div>' +
              '</div>' +
              (onClick ? '<i class="ti ti-chevron-right" style="color:var(--text-light);"></i>' : '') +
            '</div>';
  });
  html += '</div></div>';
  modal.innerHTML = html;
  document.body.appendChild(modal);
}

function bigCalPrev() {
  if (!state.bigCalMonth) return;
  let { year, month } = state.bigCalMonth;
  month--;
  if (month < 0) { month = 11; year--; }
  state.bigCalMonth = { year, month };
  loadBigCalendar();
}
function bigCalNext() {
  if (!state.bigCalMonth) return;
  let { year, month } = state.bigCalMonth;
  month++;
  if (month > 11) { month = 0; year++; }
  state.bigCalMonth = { year, month };
  loadBigCalendar();
}
function bigCalToday() {
  const now = new Date();
  state.bigCalMonth = { year: now.getFullYear(), month: now.getMonth() };
  loadBigCalendar();
}

// ---- Виджет «Отпуска» на Главной ----
async function loadHomeVacations() {
  try {
    const d = await apiGet('/api/vacations/current');
    cache.homeVacations = d;
    renderHomeVacations();
  } catch (e) {
    const el = document.getElementById('home-vacations-block');
    if (el) el.innerHTML = '<div class="empty-block"><i class="ti ti-info-circle"></i>Не удалось загрузить отпуска</div>';
  }
}

function renderHomeVacations() {
  const el = document.getElementById('home-vacations-block');
  if (!el) return;
  const d = cache.homeVacations || { current: [], upcoming: [] };
  const current = d.current || [];
  const upcoming = d.upcoming || [];
  if (!current.length && !upcoming.length) {
    el.innerHTML = '<div class="empty-block" style="padding: 18px;"><i class="ti ti-beach"></i>Сейчас никто не в отпуске. Ближайших на 2 недели — тоже нет.</div>';
    return;
  }
  let html = '<div class="vacation-widget">';
  current.forEach(v => {
    const initials = (v.employee_full_name || '').split(' ').map(w => (w[0] || '').toUpperCase()).slice(0, 2).join('');
    html += '<div class="vac-row">' +
      '<div class="vac-row-avatar">' + escapeHtml(initials || '?') + '</div>' +
      '<div class="vac-row-body">' +
        '<div class="vac-row-name">' + escapeHtml(v.employee_full_name || '—') + '</div>' +
        '<div class="vac-row-dates">' + escapeHtml(formatVacDates(v.start_date, v.end_date)) + ' · ' + v.days_total + ' дн.</div>' +
      '</div>' +
      '<div class="vac-row-tag is-current">в отпуске</div>' +
      '</div>';
  });
  upcoming.forEach(v => {
    const initials = (v.employee_full_name || '').split(' ').map(w => (w[0] || '').toUpperCase()).slice(0, 2).join('');
    html += '<div class="vac-row">' +
      '<div class="vac-row-avatar">' + escapeHtml(initials || '?') + '</div>' +
      '<div class="vac-row-body">' +
        '<div class="vac-row-name">' + escapeHtml(v.employee_full_name || '—') + '</div>' +
        '<div class="vac-row-dates">с ' + escapeHtml(formatVacDates(v.start_date, v.end_date)) + ' · ' + v.days_total + ' дн.</div>' +
      '</div>' +
      '<div class="vac-row-tag is-upcoming">скоро</div>' +
      '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

function formatVacDates(start, end) {
  // 2026-05-15 → 15 мая
  function fmt(iso) {
    const parts = (iso || '').split('-');
    if (parts.length !== 3) return iso;
    return parseInt(parts[2], 10) + ' ' + MONTH_GENITIVE[parseInt(parts[1], 10) - 1];
  }
  return fmt(start) + ' — ' + fmt(end);
}


function todayHumanRu() {
  const d = new Date();
  const months = ['января','февраля','марта','апреля','мая','июня',
                  'июля','августа','сентября','октября','ноября','декабря'];
  const days = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
  return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ' · ' + days[d.getDay()];
}

// ---------- KPI ----------

async function loadHomeKpi() {
  try {
    const d = await apiGet('/api/home/kpi');
    cache.homeKpi = d;
    renderHomeKpi();
  } catch (e) {
    const el = document.getElementById('home-kpi-block');
    if (el) el.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить показатели</div>';
  }
}

function renderHomeKpi() {
  const el = document.getElementById('home-kpi-block');
  if (!el) return;
  const data = (cache.homeKpi && cache.homeKpi.kpi) || {};
  const tiles = [];
  if ('contracts_active' in data) {
    tiles.push({
      label: 'договоров', value: data.contracts_active, trend: 'в производстве',
      icon: 'ti-file-text', color: 'blue',
      action: () => goToSection('sales', 'sales-contracts')
    });
  }
  if ('offers_active' in data) {
    tiles.push({
      label: 'КП в работе', value: data.offers_active, trend: 'черновики и отправленные',
      icon: 'ti-file-invoice', color: 'amber',
      action: () => goToSection('sales', 'sales-offers')
    });
  }
  if ('assemblies_today' in data) {
    tiles.push({
      label: 'сборок сегодня', value: data.assemblies_today, trend: 'шт.',
      icon: 'ti-tool', color: 'green',
      action: () => goToSection('production', 'history')
    });
  }
  if ('offers_accepted_month_sum' in data) {
    tiles.push({
      label: 'принято КП', value: formatMoneyShort(data.offers_accepted_month_sum), trend: 'за месяц',
      icon: 'ti-coin', color: 'violet'
    });
  }
  if (!tiles.length) {
    el.innerHTML = '<div class="empty-block"><i class="ti ti-info-circle"></i>Для вашей роли нет показателей на главной</div>';
    return;
  }
  let html = '<div class="kpi-grid">';
  tiles.forEach((t, i) => {
    const clickable = t.action ? ' onclick="homeKpiClick(' + i + ')"' : '';
    const colorCls = t.color ? ' kpi-' + t.color : '';
    html += '<div class="kpi-card' + colorCls + (t.action ? ' kpi-clickable' : '') + '"' + clickable + '>' +
      '<div class="kpi-icon"><i class="ti ' + escapeText(t.icon || 'ti-circle') + '"></i></div>' +
      '<div class="kpi-text">' +
        '<div class="label">' + escapeText(t.label) + '</div>' +
        '<div class="value">' + escapeText(String(t.value)) + '</div>' +
        '<div class="trend">' + escapeText(t.trend) + '</div>' +
      '</div>' +
      '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
  // Сохраняем actions для клика
  window._homeKpiActions = tiles.map(t => t.action || null);
}

function homeKpiClick(idx) {
  const fn = (window._homeKpiActions || [])[idx];
  if (typeof fn === 'function') fn();
}

// v2.43.98: загрузка расширенного дашборда (воронка, алерты, ТОП сборщиков)
async function loadHomeDashboardExtras() {
  try {
    const d = await apiGet('/api/home/dashboard-extras');
    cache.homeExtras = d;
    renderHomeFunnel();
    renderHomeAlerts();
    renderHomeTopAssemblers();
  } catch (e) {
    const f = document.getElementById('home-funnel-block');
    if (f) f.innerHTML = '<div class="empty-block" style="margin: 0 14px;"><i class="ti ti-alert-triangle"></i>Не удалось загрузить воронку</div>';
    const a = document.getElementById('home-alerts-block');
    if (a) a.innerHTML = '';
    const t = document.getElementById('home-top-assemblers-block');
    if (t) t.innerHTML = '<div class="empty-block" style="margin: 0 14px;"><i class="ti ti-alert-triangle"></i>Не удалось загрузить ТОП</div>';
  }
}

function renderHomeFunnel() {
  const el = document.getElementById('home-funnel-block');
  if (!el) return;
  const stages = (cache.homeExtras && cache.homeExtras.funnel) || [];
  if (!stages.length) {
    el.innerHTML = '<div class="empty-block" style="margin: 0 14px;"><i class="ti ti-info-circle"></i>Пока нет активных работ</div>';
    return;
  }
  let html = '<div class="home-funnel">';
  stages.forEach(s => {
    html += '<div class="home-funnel-stage" data-st="' + escapeText(s.status) + '" onclick="homeFunnelClick(\'' + escapeText(s.status) + '\')">' +
      '<div class="stage-label">' + escapeText(s.label) + '</div>' +
      '<div class="stage-count">' + escapeText(String(s.count || 0)) + '</div>' +
      '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

function homeFunnelClick(status) {
  // Открыть канбан с подсветкой колонки (если возможно)
  goToSection('production', 'dashboard');
}

function renderHomeAlerts() {
  const el = document.getElementById('home-alerts-block');
  if (!el) return;
  const alerts = (cache.homeExtras && cache.homeExtras.alerts) || [];
  if (!alerts.length) {
    el.innerHTML = '<div class="empty-block" style="margin: 0 14px;"><i class="ti ti-circle-check"></i>Алертов нет — всё спокойно</div>';
    return;
  }
  let html = '<div class="home-alerts-list">';
  alerts.forEach((a, i) => {
    html += '<div class="home-alert" data-sev="' + escapeText(a.severity || 'info') + '" onclick="homeAlertClick(' + i + ')">' +
      '<i class="ti ' + escapeText(a.icon || 'ti-alert-triangle') + ' alert-icon"></i>' +
      '<div class="alert-body">' +
        '<div class="alert-title">' + escapeText(a.title || '') + '</div>' +
        '<div class="alert-meta">' + escapeText(a.meta || '') + '</div>' +
      '</div>' +
      '<div class="alert-count">' + escapeText(String(a.count || 0)) + '</div>' +
      '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

function homeAlertClick(idx) {
  const alerts = (cache.homeExtras && cache.homeExtras.alerts) || [];
  const a = alerts[idx];
  if (!a) return;
  if (a.link === 'production') {
    goToSection('production', 'dashboard');
  } else if (a.link === 'contracts') {
    goToSection('sales', 'sales-contracts');
  } else if (a.link === 'warehouse') {
    goToSection('warehouse', 'warehouse-components');
  }
}

function renderHomeTopAssemblers() {
  const el = document.getElementById('home-top-assemblers-block');
  if (!el) return;
  const rows = (cache.homeExtras && cache.homeExtras.top_assemblers) || [];
  if (!rows.length) {
    el.innerHTML = '<div class="empty-block" style="margin: 0 14px;"><i class="ti ti-info-circle"></i>За неделю никто не отметил часы</div>';
    return;
  }
  let html = '<div class="home-top-assemblers">';
  rows.forEach((r, i) => {
    const rank = i + 1;
    const rankCls = rank <= 3 ? ' r' + rank : '';
    html += '<div class="home-top-row' + rankCls + '">' +
      '<div class="top-rank">' + rank + '</div>' +
      '<div class="top-name">' + escapeText(r.name || '—') + '</div>' +
      '<div class="top-stats">' +
        '<span><b>' + escapeText(String(r.hours || 0)) + '</b> ч</span>' +
        '<span><b>' + escapeText(String(r.works || 0)) + '</b> работ</span>' +
      '</div>' +
      '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

function goToSection(sectionCode, navItem) {
  // Переход в раздел production/sales и выбор пункта внутри
  const tab = document.querySelector('.section-tab[data-section="' + sectionCode + '"]')
           || document.querySelector('.m-section-tabs button[data-section="' + sectionCode + '"]');
  if (tab) tab.click();
  setTimeout(() => {
    if (navItem) selectSidebarItem(navItem);
  }, 50);
}

function formatMoneyShort(amount) {
  // Короткое представление: 1.2 млн ₽ / 850 тыс. ₽ / 450 ₽
  const v = Number(amount) || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace('.', ',') + ' млн ₽';
  if (v >= 10_000) return Math.round(v / 1000) + ' тыс. ₽';
  return Math.round(v).toLocaleString('ru-RU') + ' ₽';
}

// ---------- Курс валют ЦБ ----------

async function loadCbrRates() {
  try {
    const d = await apiGet('/api/home/cbr-rates');
    cache.cbrRates = d;
    renderCbrRates();
  } catch (e) {
    const el = document.getElementById('home-cbr-block');
    if (el) el.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Курс валют недоступен</div>';
  }
}

function renderCbrRates() {
  const el = document.getElementById('home-cbr-block');
  if (!el) return;
  const d = cache.cbrRates;
  if (!d || !d.rates) {
    el.innerHTML = '<div class="empty-block"><i class="ti ti-info-circle"></i>Курс валют недоступен</div>';
    return;
  }
  const isStale = !!d.is_stale;
  const dateText = d.date ? formatCbrDate(d.date) : '';
  const flagBySymbol = { 'USD': '$', 'EUR': '€', 'CNY': '¥' };
  const colorBySymbol = { 'USD': 'green', 'EUR': 'blue', 'CNY': 'amber' };
  let html = '<div class="cbr-widget">';
  if (dateText) {
    html += '<div class="cbr-date-line' + (isStale ? ' stale' : '') + '">' +
            (isStale ? '⚠ ' : '') +
            escapeText(dateText) +
            (isStale ? ' (офлайн)' : '') +
            '</div>';
  }
  html += '<div class="cbr-grid">';
  ['USD','EUR','CNY'].forEach(code => {
    const r = d.rates[code];
    if (!r) return;
    const diff = Number(r.diff) || 0;
    const cls = diff > 0.001 ? 'up' : (diff < -0.001 ? 'down' : 'zero');
    const arrow = diff > 0.001 ? '↑' : (diff < -0.001 ? '↓' : '·');
    const absDiff = Math.abs(diff);
    html += '<div class="cbr-cell cbr-' + colorBySymbol[code] + '">' +
      '<div class="cbr-symbol">' + flagBySymbol[code] + '</div>' +
      '<div class="cbr-info">' +
        '<div class="cbr-code">' + code + '</div>' +
        '<div class="cbr-value">' + formatCbrValue(r.value) + ' ₽</div>' +
        '<div class="cbr-diff ' + cls + '">' + arrow + ' ' +
          (cls === 'zero' ? '0,00' : absDiff.toFixed(2).replace('.', ',')) +
        '</div>' +
      '</div>' +
      '</div>';
  });
  html += '</div></div>';
  el.innerHTML = html;
}

function formatCbrValue(v) {
  const n = Number(v) || 0;
  return n.toFixed(2).replace('.', ',');
}

// ============================================================
// ============ v2.43.75: РАДИО НА ГЛАВНОЙ =====================
// ============================================================
// Простой плеер на HTMLAudioElement. URL'ы потоков — публичные стримы.
// v2.43.76: расширенный список + регулировка громкости. Если станция не
// играет — открой DevTools → Network, посмотри ошибку, при необходимости
// замени URL в этом массиве (обычная ситуация для интернет-радио).
// v2.43.79: каждый URL проверен curl-ом и отдаёт 200 OK.
const RADIO_STATIONS = [
  // Хиты / поп
  { id: 'hits',          name: 'Хит ФМ',           url: 'https://hitfm.hostingradio.ru/hitfm128.mp3' },
  { id: 'maximum',       name: 'Радио Maximum',    url: 'https://maximum.hostingradio.ru/maximum128.mp3' },
  // Record
  { id: 'record',        name: 'Radio Record',     url: 'https://radiorecord.hostingradio.ru/rr_main96.aacp' },
  { id: 'record_teo',    name: 'Record · TEO',     url: 'https://radiorecord.hostingradio.ru/teo96.aacp' },
  { id: 'record_sd90',   name: 'Record · SD-90',   url: 'https://radiorecord.hostingradio.ru/sd9096.aacp' },
  { id: 'record_ibiza',  name: 'Record · Ibiza',   url: 'https://radiorecord.hostingradio.ru/ibiza96.aacp' },
  { id: 'record_chil',   name: 'Record · Chill',   url: 'https://radiorecord.hostingradio.ru/chil96.aacp' },
  { id: 'record_gold',   name: 'Record · Гольд',   url: 'https://radiorecord.hostingradio.ru/russiangold96.aacp' },
  // Наше Радио
  { id: 'nashe',         name: 'Наше Радио',       url: 'https://nashe1.hostingradio.ru/nashe-128.mp3' },
  { id: 'ultra',         name: 'Ultra (рок)',      url: 'https://nashe1.hostingradio.ru/ultra-128.mp3' },
  { id: 'rock_nashe',    name: 'Rock FM',          url: 'https://nashe2.hostingradio.ru/rock-128.mp3' },
  // DFM
  { id: 'dfm',           name: 'DFM',              url: 'https://dfm.hostingradio.ru/dfm128.mp3' },
  { id: 'dfm_disco',     name: 'DFM · Дискач 90х', url: 'https://dfm-disc90.hostingradio.ru/disc9096.aacp' },
  { id: 'dfm_rus',       name: 'DFM · Русский',    url: 'https://dfm-dfmrusdance.hostingradio.ru/dfmrusdance96.aacp' },
  // Разговорные
  { id: 'soloviev',      name: 'Соловьёв LIVE',    url: 'https://solovievfm.hostingradio.ru/solovievfm128.aacp' },
  { id: 'sputnik',       name: 'Спутник',          url: 'https://icecast-rian.cdnvideo.ru/voicerus' },
  // Шансон / поп
  { id: 'vanya',         name: 'Радио Ваня',       url: 'https://icecast-radiovanya.cdnvideo.ru/radiovanya' },
];

const RADIO_STORAGE_KEY = 'atomus_radio_v1';

function _radioState() {
  if (!window._radio) {
    window._radio = {
      audio: null,
      stationId: null,
      playing: false,
      loading: false,
      volume: 0.7,
    };
    try {
      const saved = JSON.parse(localStorage.getItem(RADIO_STORAGE_KEY) || 'null');
      if (saved && saved.stationId) window._radio.stationId = saved.stationId;
      if (saved && typeof saved.volume === 'number') {
        window._radio.volume = Math.max(0, Math.min(1, saved.volume));
      }
    } catch (e) {}
  }
  return window._radio;
}

function _radioGetStation(id) {
  return RADIO_STATIONS.find(s => s.id === id) || null;
}

function _radioSave() {
  const s = _radioState();
  try {
    localStorage.setItem(RADIO_STORAGE_KEY, JSON.stringify({
      stationId:  s.stationId,
      volume:     s.volume,
      wasPlaying: !!s.playing, // v2.43.77: для автозапуска после F5
    }));
  } catch (e) {}
}

// Обновляет визуальное состояние кнопки «Радио» в сайдбаре (играет / станция).
function renderSidebarRadio() {
  const btn = document.getElementById('sidebar-radio-btn');
  if (!btn) return;
  const s = _radioState();
  const station = s.stationId ? _radioGetStation(s.stationId) : null;
  btn.classList.toggle('playing', !!s.playing);
  const nameEl = document.getElementById('sidebar-radio-station');
  if (nameEl) nameEl.textContent = (s.playing && station) ? station.name : '';
}

// Рендер тела модалки (тёмная панель с управлением + список станций).
function _renderRadioModalBody() {
  const s = _radioState();
  const station = s.stationId ? _radioGetStation(s.stationId) : null;
  const stationName = station ? station.name : 'Выберите волну';
  const isPlaying = s.playing;
  const isLoading = s.loading;
  const playIcon = isLoading ? 'ti-loader-2' : (isPlaying ? 'ti-player-pause-filled' : 'ti-player-play-filled');
  const labelHtml = isPlaying
    ? '<span class="hr-live-dot"></span><i class="ti ti-broadcast"></i>В эфире'
    : '<i class="ti ti-radio"></i>Радио';
  const volPct = Math.round((s.volume || 0) * 100);
  const volIcon = volPct === 0 ? 'ti-volume-off' : (volPct < 40 ? 'ti-volume-2' : 'ti-volume');

  let items = '';
  RADIO_STATIONS.forEach((st, i) => {
    const active = st.id === s.stationId;
    items += '<div class="radio-station-item' + (active ? ' active' : '') + '" onclick="selectRadioStation(\'' + st.id + '\')">' +
               '<div class="rsi-num">' + (i + 1) + '.</div>' +
               '<div class="rsi-name">' + escapeHtml(st.name) + '</div>' +
               (active && isPlaying ? '<span class="hr-live-dot" style="margin-right:6px;"></span>' : '') +
               (active ? '<i class="ti ti-check rsi-check"></i>' : '') +
             '</div>';
  });

  return (
    '<div class="radio-modal-top' + (isLoading ? ' hr-loading' : '') + '">' +
      '<div class="hr-top">' +
        '<button class="hr-play" onclick="toggleRadioPlay()" title="' + (isPlaying ? 'Пауза' : 'Играть') + '">' +
          '<i class="ti ' + playIcon + '"></i>' +
        '</button>' +
        '<div class="hr-text">' +
          '<div class="hr-label">' + labelHtml + '</div>' +
          '<div class="hr-station">' + escapeHtml(stationName) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="hr-volume">' +
        '<i class="ti ' + volIcon + '" id="hr-vol-icon"></i>' +
        '<input type="range" min="0" max="100" value="' + volPct + '" oninput="setRadioVolume(this.value)">' +
        '<div class="hr-vol-pct" id="hr-vol-pct">' + volPct + '%</div>' +
      '</div>' +
    '</div>' +
    '<div class="modal-body"><div class="radio-station-list">' + items + '</div></div>'
  );
}

// Перерисовать содержимое уже открытой модалки (если она открыта).
function _refreshRadioModal() {
  const overlay = document.getElementById('radio-modal');
  if (!overlay) return;
  const inner = overlay.querySelector('.modal');
  if (!inner) return;
  // Сохраняем header, заменяем тело
  inner.querySelector('.radio-modal-content').innerHTML = _renderRadioModalBody();
}

function _radioEnsureAudio() {
  const s = _radioState();
  if (s.audio) return s.audio;
  const a = new Audio();
  a.preload = 'none';
  a.volume = s.volume;
  const onState = () => { _radioSave(); renderSidebarRadio(); _refreshRadioModal(); };
  a.addEventListener('playing', () => { s.playing = true;  s.loading = false; onState(); });
  a.addEventListener('pause',   () => { s.playing = false; s.loading = false; onState(); });
  a.addEventListener('waiting', () => { s.loading = true; _refreshRadioModal(); });
  a.addEventListener('error',   () => {
    s.playing = false; s.loading = false; onState();
    showToast('Не удалось воспроизвести станцию — проверьте интернет или выберите другую', 'error');
  });
  s.audio = a;
  return a;
}

function setRadioVolume(v) {
  const s = _radioState();
  const pct = Math.max(0, Math.min(100, parseInt(v, 10) || 0));
  s.volume = pct / 100;
  if (s.audio) s.audio.volume = s.volume;
  _radioSave();
  // Обновляем только подпись и иконку, без полного перерендера — чтобы ползунок
  // не «прыгал» во время перетаскивания.
  const pctEl = document.getElementById('hr-vol-pct');
  if (pctEl) pctEl.textContent = pct + '%';
  const iconEl = document.getElementById('hr-vol-icon');
  if (iconEl) {
    const cls = pct === 0 ? 'ti-volume-off' : (pct < 40 ? 'ti-volume-2' : 'ti-volume');
    iconEl.className = 'ti ' + cls;
  }
}

function toggleRadioPlay() {
  const s = _radioState();
  const audio = _radioEnsureAudio();
  if (!s.stationId) {
    // Нет станции — просто откроем список (модалка уже открыта, но на случай прямого вызова)
    if (!document.getElementById('radio-modal')) openRadioModal();
    return;
  }
  if (s.playing) {
    audio.pause();
    return;
  }
  const station = _radioGetStation(s.stationId);
  if (!station) return;
  if (!audio.src || audio.src !== station.url) audio.src = station.url;
  s.loading = true;
  _refreshRadioModal();
  renderSidebarRadio();
  audio.play().catch(() => {
    s.loading = false; s.playing = false; _refreshRadioModal(); renderSidebarRadio();
    showToast('Не удалось воспроизвести — проверьте интернет или выберите другую', 'error');
  });
}

function selectRadioStation(id) {
  const station = _radioGetStation(id);
  if (!station) return;
  const s = _radioState();
  const audio = _radioEnsureAudio();
  s.stationId = id;
  _radioSave();
  audio.src = station.url;
  s.loading = true;
  _refreshRadioModal();
  renderSidebarRadio();
  audio.play().catch(() => {
    s.loading = false; s.playing = false; _refreshRadioModal(); renderSidebarRadio();
    showToast('Не удалось воспроизвести — проверьте интернет или выберите другую', 'error');
  });
}

function openRadioModal() {
  // Удаляем предыдущий, если остался
  const old = document.getElementById('radio-modal');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'radio-modal';
  overlay.className = 'modal-overlay visible';
  overlay.style.zIndex = '260';
  overlay.onclick = function(e) { if (e.target === overlay) closeRadioModal(); };
  overlay.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:520px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-radio"></i> Радио</h3>' +
        '<button class="icon-btn" onclick="closeRadioModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="radio-modal-content">' + _renderRadioModalBody() + '</div>' +
    '</div>';
  document.body.appendChild(overlay);
}

function closeRadioModal() {
  const m = document.getElementById('radio-modal');
  if (m) m.remove();
}

// v2.43.77: автозапуск после F5 — если радио играло до перезагрузки, пытаемся
// возобновить. Браузерные autoplay-policy могут заблокировать — в этом случае
// тихо остаёмся на паузе, пользователь нажмёт play вручную.
async function _radioBootResume() {
  const s = _radioState();
  if (!s.stationId) { renderSidebarRadio(); return; }
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(RADIO_STORAGE_KEY) || 'null'); } catch (e) {}
  if (!saved || !saved.wasPlaying) { renderSidebarRadio(); return; }
  const station = _radioGetStation(s.stationId);
  if (!station) { renderSidebarRadio(); return; }
  const audio = _radioEnsureAudio();
  audio.src = station.url;
  s.loading = true;
  renderSidebarRadio();
  try {
    await audio.play();
  } catch (e) {
    s.loading = false;
    s.playing = false;
    renderSidebarRadio();
    // Тихо — autoplay-policy. Кнопка останется на паузе.
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Дадим основному коду немного оттранслировать UI, потом пробуем возобновить.
  setTimeout(_radioBootResume, 600);
});

function formatCbrDate(iso) {
  // iso = "2026-05-14"
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return 'на ' + dd + '.' + mm + '.' + d.getFullYear();
  } catch (e) {
    return iso;
  }
}

// ---------- Калькулятор ----------

// v2.43.65: калькулятор открывается модалкой поверх окна (десктоп и мобильная)
function openCalculatorModal() {
  // Если открыт боковой drawer — закрываем его, чтобы калькулятор был поверх
  if (typeof closeSectionDrawer === 'function') {
    try { closeSectionDrawer(); } catch (e) {}
  }
  let modal = document.getElementById('calc-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'calc-modal';
  modal.className = 'modal-overlay visible';
  modal.style.zIndex = '400'; // выше drawer (250) и overlay (240)
  modal.onclick = (e) => { if (e.target === modal) closeCalculatorModal(); };

  let html = '<div class="modal calc-modal-inner" onclick="event.stopPropagation()">';
  html += '<div class="modal-header">';
  html += '<h3><i class="ti ti-calculator"></i> Калькулятор</h3>';
  html += '<button class="icon-btn" onclick="closeCalculatorModal()"><i class="ti ti-x"></i></button>';
  html += '</div>';
  html += '<div class="modal-body" style="padding:14px 16px 18px;">';
  // Tabs
  html += '<div class="calc-tabs">';
  [['math','ti-math-symbols','Математика'],
   ['vat','ti-percentage','НДС'],
   ['fx','ti-currency-dollar','Валюты']].forEach(([code,icon,label]) => {
    html += '<button class="calc-tab' + (state.calc.mode === code ? ' active' : '') + '" onclick="setCalcMode(\'' + code + '\')">' +
            '<i class="ti ' + icon + '"></i>' + label + '</button>';
  });
  html += '</div>';
  html += '<div id="calc-tab-content">' + renderCalcTabContent() + '</div>';
  html += '</div></div>';
  modal.innerHTML = html;
  document.body.appendChild(modal);
  bindCalcHandlers();
  // v2.43.64: ввод с физической клавиатуры (десктоп)
  _calcKeydownHandler = (e) => _handleCalcKeydown(e);
  document.addEventListener('keydown', _calcKeydownHandler);
}

function closeCalculatorModal() {
  const modal = document.getElementById('calc-modal');
  if (modal) modal.remove();
  // v2.43.64: снять обработчик клавиатуры
  if (_calcKeydownHandler) {
    document.removeEventListener('keydown', _calcKeydownHandler);
    _calcKeydownHandler = null;
  }
}

// v2.43.64: обработка нажатий физической клавиатуры в калькуляторе
let _calcKeydownHandler = null;
function _handleCalcKeydown(e) {
  if (!document.getElementById('calc-modal')) return;
  // Escape — закрыть всегда
  if (e.key === 'Escape') { e.preventDefault(); closeCalculatorModal(); return; }
  // В режимах НДС/валюты фокус в input — нативный ввод, не перехватываем (кроме Escape)
  if (state.calc.mode !== 'math') return;
  const k = e.key;
  if (k >= '0' && k <= '9') { e.preventDefault(); digitMath(k); }
  else if (k === '.' || k === ',') { e.preventDefault(); dotMath(); }
  else if (k === '+') { e.preventDefault(); opMath('+'); }
  else if (k === '-') { e.preventDefault(); opMath('-'); }
  else if (k === '*') { e.preventDefault(); opMath('*'); }
  else if (k === '/') { e.preventDefault(); opMath('/'); }
  else if (k === '%') { e.preventDefault(); percentMath(); }
  else if (k === 'Enter' || k === '=') { e.preventDefault(); equalsMath(); }
  else if (k === 'Backspace') { e.preventDefault(); backMath(); }
  else if (k === 'c' || k === 'C' || k === 'Delete') { e.preventDefault(); clearMath(); }
}

// Совместимость: старый вызов renderCalculator больше ничего не делает на главной
function renderCalculator() {
  const el = document.getElementById('home-calc-block');
  if (!el) return; // блок убран с главной в v2.43.60
}

function toggleCalculator() {
  // Старое поведение (inline) больше не используется — открываем модалку
  openCalculatorModal();
}

function setCalcMode(mode) {
  state.calc.mode = mode;
  const inner = document.getElementById('calc-tab-content');
  if (inner) inner.innerHTML = renderCalcTabContent();
  // Обновим active в табах (теперь в модалке)
  document.querySelectorAll('#calc-modal .calc-tab, #calc-widget .calc-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector('#calc-modal .calc-tab[onclick*="\'' + mode + '\'"], #calc-widget .calc-tab[onclick*="\'' + mode + '\'"]');
  if (activeTab) activeTab.classList.add('active');
  bindCalcHandlers();
}

function renderCalcTabContent() {
  if (state.calc.mode === 'math') return renderCalcMath();
  if (state.calc.mode === 'vat') return renderCalcVat();
  if (state.calc.mode === 'fx') return renderCalcFx();
  return '';
}

// ---- Калькулятор: математика ----

function renderCalcMath() {
  let html = '';
  html += '<div class="calc-display">';
  html += '<div class="calc-expr">' + escapeText(state.calc.mathExpr || '\u00A0') + '</div>';
  html += escapeText(state.calc.mathDisplay);
  html += '</div>';
  html += '<div class="calc-keys">';
  const keys = [
    ['C','clear','clearMath'],
    ['±','op','negateMath'],
    ['%','op','percentMath'],
    ['÷','op','opMath','/'],
    ['7','','digitMath','7'],['8','','digitMath','8'],['9','','digitMath','9'],
    ['×','op','opMath','*'],
    ['4','','digitMath','4'],['5','','digitMath','5'],['6','','digitMath','6'],
    ['−','op','opMath','-'],
    ['1','','digitMath','1'],['2','','digitMath','2'],['3','','digitMath','3'],
    ['+','op','opMath','+'],
    ['0','','digitMath','0'],['.','','dotMath'],
    ['⌫','clear','backMath'],
    ['=','eq','equalsMath'],
  ];
  keys.forEach(k => {
    const [label, cls, fn, arg] = [k[0], k[1], k[2], k[3]];
    const argStr = arg !== undefined ? "'" + arg + "'" : '';
    html += '<button class="calc-key ' + cls + '" onclick="' + fn + '(' + argStr + ')">' + label + '</button>';
  });
  html += '</div>';
  return html;
}

function _updateMathDisplay() {
  // Перерисовка только области математики
  const inner = document.getElementById('calc-tab-content');
  if (!inner) return;
  inner.innerHTML = renderCalcMath();
}

function digitMath(d) {
  if (state.calc.mathReset) {
    state.calc.mathDisplay = '0';
    state.calc.mathReset = false;
  }
  if (state.calc.mathDisplay === '0') state.calc.mathDisplay = d;
  else if (state.calc.mathDisplay.length < 14) state.calc.mathDisplay += d;
  _updateMathDisplay();
}

function dotMath() {
  if (state.calc.mathReset) {
    state.calc.mathDisplay = '0';
    state.calc.mathReset = false;
  }
  if (!state.calc.mathDisplay.includes('.')) state.calc.mathDisplay += '.';
  _updateMathDisplay();
}

function clearMath() {
  state.calc.mathDisplay = '0';
  state.calc.mathExpr = '';
  state.calc.mathPrev = null;
  state.calc.mathOp = null;
  state.calc.mathReset = false;
  _updateMathDisplay();
}

function backMath() {
  if (state.calc.mathReset) { clearMath(); return; }
  if (state.calc.mathDisplay.length <= 1) state.calc.mathDisplay = '0';
  else state.calc.mathDisplay = state.calc.mathDisplay.slice(0, -1);
  _updateMathDisplay();
}

function negateMath() {
  if (state.calc.mathDisplay === '0') return;
  if (state.calc.mathDisplay.startsWith('-')) state.calc.mathDisplay = state.calc.mathDisplay.slice(1);
  else state.calc.mathDisplay = '-' + state.calc.mathDisplay;
  _updateMathDisplay();
}

function percentMath() {
  const v = parseFloat(state.calc.mathDisplay) || 0;
  state.calc.mathDisplay = String(v / 100);
  _updateMathDisplay();
}

function opMath(op) {
  // Если уже был оператор и есть prev — посчитать сначала
  if (state.calc.mathPrev !== null && state.calc.mathOp && !state.calc.mathReset) {
    equalsMath();
  }
  state.calc.mathPrev = parseFloat(state.calc.mathDisplay) || 0;
  state.calc.mathOp = op;
  state.calc.mathExpr = _formatMathNum(state.calc.mathPrev) + ' ' + _opSym(op);
  state.calc.mathReset = true;
  _updateMathDisplay();
}

function _opSym(op) {
  return op === '*' ? '×' : op === '/' ? '÷' : op === '-' ? '−' : '+';
}

function _formatMathNum(n) {
  const s = Number(n).toString();
  if (s.length > 14) return Number(n).toExponential(4);
  return s;
}

function equalsMath() {
  if (state.calc.mathPrev === null || !state.calc.mathOp) return;
  const a = state.calc.mathPrev;
  const b = parseFloat(state.calc.mathDisplay) || 0;
  let result = 0;
  switch (state.calc.mathOp) {
    case '+': result = a + b; break;
    case '-': result = a - b; break;
    case '*': result = a * b; break;
    case '/': result = b === 0 ? NaN : a / b; break;
  }
  state.calc.mathExpr = _formatMathNum(a) + ' ' + _opSym(state.calc.mathOp) + ' ' + _formatMathNum(b) + ' =';
  state.calc.mathDisplay = isNaN(result) ? 'Ошибка' : _formatMathNum(Math.round(result * 1e10) / 1e10);
  state.calc.mathPrev = null;
  state.calc.mathOp = null;
  state.calc.mathReset = true;
  _updateMathDisplay();
}

// ---- Калькулятор: НДС ----

function renderCalcVat() {
  const rate = state.calc.vatRate;
  let html = '';
  html += '<div class="calc-vat-row">';
  html += '<button class="calc-mode-btn' + (state.calc.vatMode === 'add' ? ' active' : '') + '" onclick="setVatMode(\'add\')">Из суммы без НДС</button>';
  html += '<button class="calc-mode-btn' + (state.calc.vatMode === 'extract' ? ' active' : '') + '" onclick="setVatMode(\'extract\')">Из суммы с НДС</button>';
  html += '</div>';
  html += '<div class="calc-input-row">';
  html += '<input type="text" inputmode="decimal" id="calc-vat-input" value="' + escapeText(state.calc.vatInput) + '" placeholder="0">';
  html += '<div class="calc-suffix">₽</div>';
  html += '</div>';
  // Расчёт
  const num = parseFloat((state.calc.vatInput || '').replace(',', '.')) || 0;
  let netto = 0, vatSum = 0, brutto = 0;
  if (state.calc.vatMode === 'add') {
    netto = num;
    vatSum = num * rate / 100;
    brutto = num + vatSum;
  } else {
    brutto = num;
    netto = num / (1 + rate / 100);
    vatSum = brutto - netto;
  }
  html += '<div class="calc-result">' +
    '<span class="calc-result-label">Без НДС</span>' +
    '<span class="calc-result-value">' + formatMoneyCalc(netto) + '</span></div>';
  html += '<div class="calc-result">' +
    '<span class="calc-result-label">НДС ' + rate + '%</span>' +
    '<span class="calc-result-value">' + formatMoneyCalc(vatSum) + '</span></div>';
  html += '<div class="calc-result highlight">' +
    '<span class="calc-result-label">С НДС</span>' +
    '<span class="calc-result-value">' + formatMoneyCalc(brutto) + '</span></div>';
  html += '<div style="display:flex; justify-content:flex-end; align-items:center; gap:8px; margin-top:8px; font-size:11.5px; color:var(--text-light);">' +
    '<span>Ставка НДС:</span>' +
    '<select id="calc-vat-rate-select" style="padding:2px 6px; font-size:11.5px;">' +
    '<option value="22"' + (rate === 22 ? ' selected' : '') + '>22%</option>' +
    '<option value="20"' + (rate === 20 ? ' selected' : '') + '>20%</option>' +
    '<option value="10"' + (rate === 10 ? ' selected' : '') + '>10%</option>' +
    '<option value="0"' + (rate === 0 ? ' selected' : '') + '>0%</option>' +
    '</select></div>';
  return html;
}

function setVatMode(mode) {
  state.calc.vatMode = mode;
  setCalcMode('vat');
}

function formatMoneyCalc(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
}

// ---- Калькулятор: валюты ----

function renderCalcFx() {
  const rates = cache.cbrRates && cache.cbrRates.rates;
  if (!rates) {
    return '<div class="empty-block" style="padding:18px;"><i class="ti ti-currency-ruble"></i>Курс валют ещё загружается…</div>';
  }
  const from = state.calc.fxFromCurrency;
  const to = state.calc.fxToCurrency;
  const valFrom = parseFloat((state.calc.fxFromValue || '').replace(',', '.')) || 0;
  // Конвертация: RUB ↔ X. Считаем через RUB как опору.
  const fxToRub = (cur, amt) => cur === 'RUB' ? amt : amt * (rates[cur]?.value || 0);
  const fxFromRub = (cur, amtRub) => cur === 'RUB' ? amtRub : (rates[cur]?.value ? amtRub / rates[cur].value : 0);
  const rub = fxToRub(from, valFrom);
  const result = fxFromRub(to, rub);

  let html = '<div class="calc-fx-row">';
  html += '<div class="calc-fx-cell"><label>Сумма</label><div class="calc-fx-input-wrap">' +
    '<input type="text" inputmode="decimal" id="calc-fx-input" value="' + escapeText(state.calc.fxFromValue) + '" placeholder="0">' +
    '<select id="calc-fx-from-cur">' +
      currencyOptions(from) +
    '</select></div></div>';
  html += '<div class="calc-fx-arrow"><i class="ti ti-arrows-right-left"></i></div>';
  html += '<div class="calc-fx-cell"><label>=</label><div class="calc-fx-input-wrap">' +
    '<input type="text" readonly value="' + (result ? result.toLocaleString('ru-RU', {maximumFractionDigits: 2}) : '0') + '" style="background:var(--brand-bg); color:var(--brand); font-weight:600;">' +
    '<select id="calc-fx-to-cur">' +
      currencyOptions(to) +
    '</select></div></div>';
  html += '</div>';
  // Курсовая подсказка
  let note = '';
  if (from !== to && valFrom > 0) {
    const oneFrom = fxFromRub(to, fxToRub(from, 1));
    note = '1 ' + from + ' = ' + oneFrom.toFixed(4).replace('.', ',') + ' ' + to + ' (по курсу ЦБ)';
  } else if (from === to) {
    note = 'Выберите разные валюты';
  } else {
    note = 'Введите сумму';
  }
  html += '<div class="calc-fx-rate-note">' + escapeText(note) + '</div>';
  return html;
}

function currencyOptions(selected) {
  return ['RUB','USD','EUR','CNY'].map(c =>
    '<option value="' + c + '"' + (c === selected ? ' selected' : '') + '>' + c + '</option>'
  ).join('');
}

// ---- Подвязка обработчиков калькулятора ----

function bindCalcHandlers() {
  // НДС
  const vatInput = document.getElementById('calc-vat-input');
  if (vatInput) {
    vatInput.addEventListener('input', e => {
      state.calc.vatInput = e.target.value;
      _updateVatResults();
    });
  }
  const vatRateSelect = document.getElementById('calc-vat-rate-select');
  if (vatRateSelect) {
    vatRateSelect.addEventListener('change', e => {
      state.calc.vatRate = parseInt(e.target.value) || 22;
      _updateVatResults();
    });
  }
  // Валюты
  const fxInput = document.getElementById('calc-fx-input');
  if (fxInput) {
    fxInput.addEventListener('input', e => {
      state.calc.fxFromValue = e.target.value;
      _updateFxResult();
    });
  }
  const fxFrom = document.getElementById('calc-fx-from-cur');
  if (fxFrom) fxFrom.addEventListener('change', e => {
    state.calc.fxFromCurrency = e.target.value;
    _updateFxResult();
  });
  const fxTo = document.getElementById('calc-fx-to-cur');
  if (fxTo) fxTo.addEventListener('change', e => {
    state.calc.fxToCurrency = e.target.value;
    _updateFxResult();
  });
}

// Частичный пересчёт НДС — не пересоздаёт input
function _updateVatResults() {
  const rate = state.calc.vatRate;
  const num = parseFloat((state.calc.vatInput || '').replace(',', '.')) || 0;
  let netto = 0, vatSum = 0, brutto = 0;
  if (state.calc.vatMode === 'add') {
    netto = num; vatSum = num * rate / 100; brutto = num + vatSum;
  } else {
    brutto = num; netto = num / (1 + rate / 100); vatSum = brutto - netto;
  }
  // Обновляем три плашки
  const resEls = document.querySelectorAll('#calc-tab-content .calc-result .calc-result-value');
  if (resEls.length >= 3) {
    resEls[0].textContent = formatMoneyCalc(netto);
    resEls[1].textContent = formatMoneyCalc(vatSum);
    resEls[2].textContent = formatMoneyCalc(brutto);
  }
  // Обновим лейбл НДС-строки (вдруг ставку поменяли)
  const labelEls = document.querySelectorAll('#calc-tab-content .calc-result .calc-result-label');
  if (labelEls.length >= 2) labelEls[1].textContent = 'НДС ' + rate + '%';
}

// Частичный пересчёт валют — не пересоздаёт input
function _updateFxResult() {
  const rates = cache.cbrRates && cache.cbrRates.rates;
  if (!rates) return;
  const from = state.calc.fxFromCurrency;
  const to = state.calc.fxToCurrency;
  const valFrom = parseFloat((state.calc.fxFromValue || '').replace(',', '.')) || 0;
  const fxToRub = (cur, amt) => cur === 'RUB' ? amt : amt * (rates[cur]?.value || 0);
  const fxFromRub = (cur, amtRub) => cur === 'RUB' ? amtRub : (rates[cur]?.value ? amtRub / rates[cur].value : 0);
  const rub = fxToRub(from, valFrom);
  const result = fxFromRub(to, rub);

  const resultInput = document.querySelector('#calc-tab-content .calc-fx-cell:last-of-type input[readonly]');
  if (resultInput) {
    resultInput.value = result ? result.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : '0';
  }
  const noteEl = document.querySelector('#calc-tab-content .calc-fx-rate-note');
  if (noteEl) {
    if (from !== to && valFrom > 0) {
      const oneFrom = fxFromRub(to, fxToRub(from, 1));
      noteEl.textContent = '1 ' + from + ' = ' + oneFrom.toFixed(4).replace('.', ',') + ' ' + to + ' (по курсу ЦБ)';
    } else if (from === to) {
      noteEl.textContent = 'Выберите разные валюты';
    } else {
      noteEl.textContent = 'Введите сумму';
    }
  }
}

// ============ КОНЕЦ ЭТАПА 16Б ============

// ============================================================================
// ============ ЭТАП 16В: ЗАДАЧИ С ПЛАНЁРКИ ===================================
// ============================================================================

cache.tasks = {};            // {tab: {tasks:[], counts:{}}}
cache.myTasks = null;        // виджет на главной

state.tasksFilter = 'open';
state.currentTaskId = null;
state.taskFormMode = 'new';
state.taskForm = {
  title: '',
  description: '',
  assignee_id: null,
  assignee_name: '',
  deadline: '',
  priority: 'normal',
  source: '',
  // ЭТАП 16В-2: привязка к договору
  contract_id: null,
  contract_label: '',
};
// ЭТАП 16В-2: если задача создаётся из карточки договора, прокидываем сюда id —
// чтобы openNewTask подставил договор в форму автоматически.
state.taskFromContractId = null;
state.taskFromContractLabel = '';
// ЭТАП 16В-2: режим работы контракт-пикера ('assembly' — старый, 'task' — новый).
state.contractPickerMode = 'assembly';

const TASK_PRIORITIES = [
  { code: 'low',    label: 'Низкий',  icon: 'ti-arrow-down' },
  { code: 'normal', label: 'Обычный', icon: 'ti-equal' },
  { code: 'urgent', label: 'Срочный', icon: 'ti-flame' },
];
const TASK_STATUSES = [
  { code: 'new',         label: 'Новая' },
  { code: 'in_progress', label: 'В работе' },
  { code: 'done',        label: 'Готово' },
  { code: 'cancelled',   label: 'Отменено' },
];

function canManageTasks() {
  if (!state.user) return false;
  const r = state.user.roles || [];
  return r.includes('director') || r.includes('zam') || r.includes('manager');
}

// ---- Список задач (общий рендер для трёх экранов) ----
// v2.43.92: добавлен переключатель «Список / Доска» и счётчики в чипах.

function _tasksViewInit() {
  if (!state.tasksView) {
    state.tasksView = localStorage.getItem('atomus_tasks_view') || 'list';
  }
}
function setTasksView(view) {
  state.tasksView = view;
  try { localStorage.setItem('atomus_tasks_view', view); } catch (e) {}
  document.querySelectorAll('#tasks-view-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.tv === view);
  });
  // v2.45.81: синхронизация мобильных кнопок Список/Доска
  document.querySelectorAll('#m-tasks-view-row .m-view-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tv === view);
  });
  // На доске статус-фильтр не имеет смысла — прячем чипы
  const filterRow = document.querySelector('#tasks-filters > div:first-child');
  if (filterRow) filterRow.style.visibility = (view === 'board') ? 'hidden' : '';
  const mChips = document.getElementById('m-tasks-filter-chips');
  if (mChips) mChips.style.display = (view === 'board') ? 'none' : '';
  loadTasksList();
}

async function loadTasksList() {
  _tasksViewInit();
  const view = state.tasksView || 'list';
  const filter = state.tasksFilter;
  const container = document.getElementById('tasks-list-content');

  // Обновим состояние переключателя (после перезахода на экран)
  document.querySelectorAll('#tasks-view-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.tv === view);
  });
  const filterRow = document.querySelector('#tasks-filters > div:first-child');
  if (filterRow) filterRow.style.visibility = (view === 'board') ? 'hidden' : '';

  // На доске всегда грузим всё (без фильтра по статусу). В списке — по текущему фильтру.
  const cacheKey = (view === 'board') ? 'board' : filter;
  if (cache.tasks[cacheKey]) {
    renderTasksScreen(cache.tasks[cacheKey]);
    return;
  }
  container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const q = (view === 'board' || filter === 'all') ? '' : '?status=' + filter;
    const d = await apiGet('/api/tasks' + q);
    cache.tasks[cacheKey] = d;
    renderTasksScreen(d);
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderTasksScreen(d) {
  // Обновим счётчики в чипах и subtitle
  const c = d.counts || {};
  const cAll = (c.new || 0) + (c.in_progress || 0) + (c.done || 0) + (c.cancelled || 0);
  const ids = [['open', c.open || 0], ['new', c.new || 0], ['in_progress', c.in_progress || 0],
               ['done', c.done || 0], ['all', cAll]];
  ids.forEach(([k, v]) => {
    const el = document.getElementById('tf-cnt-' + k);
    if (el) el.textContent = v;
    // v2.45.81: дублируем счётчики на мобильных чипсах
    const elM = document.getElementById('m-tf-cnt-' + k);
    if (elM) elM.textContent = v;
  });
  const subtitleEl = document.getElementById('tasks-list-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = (c.open || 0) + ' открытых · ' + (c.done || 0) + ' готовых';
  }
  const newBtnEl = document.getElementById('tasks-new-btn');
  if (newBtnEl) newBtnEl.style.display = canManageTasks() ? '' : 'none';

  if ((state.tasksView || 'list') === 'board') {
    renderTasksBoard(d);
  } else {
    renderTasksList(d);
  }
}

function renderTasksList(d) {
  const container = document.getElementById('tasks-list-content');
  const tasks = d.tasks || [];
  if (!tasks.length) {
    let html = '<div class="empty-block"><i class="ti ti-checklist"></i>';
    html += state.tasksFilter === 'open' ? 'Открытых задач нет.' : 'В этом фильтре нет задач.';
    if (canManageTasks()) {
      html += '<br><br><button class="btn btn-primary" onclick="openNewTask()" style="margin: 0 auto;"><i class="ti ti-plus"></i> Создать задачу</button>';
    }
    html += '</div>';
    container.innerHTML = html;
    return;
  }
  let html = '<div style="padding: 0 18px;">';
  tasks.forEach(t => { html += renderTaskRow(t); });
  html += '</div>';
  container.innerHTML = html;
}

// v2.43.92: канбан-доска задач
function renderTasksBoard(d) {
  const container = document.getElementById('tasks-list-content');
  const tasks = d.tasks || [];
  const cols = [
    { key: 'new',         title: 'Новые',    empty: 'Здесь будут новые задачи' },
    { key: 'in_progress', title: 'В работе', empty: 'Никто не взял в работу' },
    { key: 'done',        title: 'Готовые',  empty: 'Пока пусто' },
  ];
  const byCol = { new: [], in_progress: [], done: [] };
  tasks.forEach(t => {
    if (byCol[t.status]) byCol[t.status].push(t);
  });

  let html = '<div class="tasks-board">';
  cols.forEach(col => {
    const items = byCol[col.key];
    html += '<div class="tasks-board-col" data-col="' + col.key + '"' +
            ' ondragover="event.preventDefault();this.classList.add(\'drag-over\');"' +
            ' ondragleave="this.classList.remove(\'drag-over\');"' +
            ' ondrop="_tasksBoardDrop(event, \'' + col.key + '\')">';
    html += '<div class="tasks-board-col-header">' +
              '<div class="tasks-board-col-title"><span class="col-dot"></span>' + escapeHtml(col.title) + '</div>' +
              '<span class="tasks-board-col-count">' + items.length + '</span>' +
            '</div>';
    html += '<div class="tasks-board-col-body">';
    if (items.length === 0) {
      html += '<div class="tasks-board-empty">' + escapeHtml(col.empty) + '</div>';
    } else {
      items.forEach(t => { html += _renderTaskBoardCard(t); });
    }
    html += '</div></div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function _renderTaskBoardCard(t) {
  const pri = t.priority || 'normal';
  const meta = [];
  if (t.assignee_name) meta.push('<span><i class="ti ti-user"></i>' + escapeHtml(t.assignee_name) + '</span>');
  if (t.deadline) {
    let cls = '';
    try {
      const diff = Math.round((new Date(t.deadline) - new Date()) / 86400000);
      if (t.status !== 'done' && diff < 0) cls = ' urgent';
      else if (t.status !== 'done' && diff <= 1) cls = ' soon';
    } catch (e) {}
    meta.push('<span class="task-meta-deadline' + cls + '"><i class="ti ti-clock"></i>' +
              escapeHtml(formatTaskDeadline(t.deadline)) + '</span>');
  }
  if (t.contract_number) {
    meta.push('<span class="task-meta-contract" onclick="event.stopPropagation();openContractFromTask(' + t.contract_id + ')"><i class="ti ti-file-text"></i>' + escapeHtml(t.contract_number) + '</span>');
  }
  return '<div class="tasks-board-card priority-' + pri + '"' +
           ' draggable="true"' +
           ' ondragstart="_tasksBoardDragStart(event,' + t.id + ',\'' + t.status + '\')"' +
           ' ondragend="this.classList.remove(\'dragging\')"' +
           ' onclick="openTaskDetail(' + t.id + ')">' +
    '<div class="tasks-board-card-title">' + escapeHtml(t.title) + '</div>' +
    (meta.length ? '<div class="tasks-board-card-meta">' + meta.join('') + '</div>' : '') +
  '</div>';
}

let _tasksDraggingId = null;
let _tasksDraggingFrom = null;
function _tasksBoardDragStart(ev, taskId, fromStatus) {
  _tasksDraggingId = taskId;
  _tasksDraggingFrom = fromStatus;
  ev.dataTransfer.effectAllowed = 'move';
  ev.currentTarget.classList.add('dragging');
}
async function _tasksBoardDrop(ev, toStatus) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('drag-over');
  const taskId = _tasksDraggingId;
  const from = _tasksDraggingFrom;
  _tasksDraggingId = null;
  _tasksDraggingFrom = null;
  if (!taskId || from === toStatus) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/tasks/' + taskId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ status: toStatus }),
    });
    if (!r.ok) { showToast('Не удалось сменить статус', 'error'); return; }
    showToast('Статус обновлён', 'success');
    cache.tasks = {};
    loadTasksList();
  } catch (e) { showToast('Ошибка: ' + (e && e.message || e), 'error'); }
}

// v2.43.92: быстрое завершение задачи без открытия деталей
async function _tasksQuickDone(ev, taskId) {
  ev.stopPropagation();
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/tasks/' + taskId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ status: 'done' }),
    });
    if (!r.ok) { showToast('Не удалось завершить', 'error'); return; }
    showToast('Задача завершена', 'success');
    cache.tasks = {};
    loadTasksList();
  } catch (e) { showToast('Ошибка: ' + (e && e.message || e), 'error'); }
}

function renderTaskRow(t) {
  const isDone = t.status === 'done' || t.status === 'cancelled';
  const priorityCls = t.priority || 'normal';
  const meta = [];
  if (t.assignee_name) meta.push('<span><i class="ti ti-user"></i>' + escapeHtml(t.assignee_name) + '</span>');
  // Дедлайн с подсветкой
  if (t.deadline) {
    let cls = '';
    try {
      const diff = Math.round((new Date(t.deadline) - new Date()) / 86400000);
      if (!isDone && diff < 0) cls = ' urgent';
      else if (!isDone && diff <= 1) cls = ' soon';
    } catch (e) {}
    meta.push('<span class="task-meta-deadline' + cls + '"><i class="ti ti-clock"></i>' +
              escapeHtml(formatTaskDeadline(t.deadline)) + '</span>');
  }
  if (t.source) meta.push('<span><i class="ti ti-tag"></i>' + escapeHtml(t.source) + '</span>');
  // ЭТАП 16В-2: бейдж договора
  if (t.contract_id && t.contract_number) {
    const archived = !t.contract_is_active;
    const label = t.contract_number + (t.contractor_name ? ' · ' + t.contractor_name : '');
    meta.push(
      '<span class="task-meta-contract' + (archived ? ' archived' : '') +
      '" onclick="event.stopPropagation(); openContractFromTask(' + t.contract_id + ')" title="' +
      escapeHtml(archived ? 'Договор в архиве' : 'Перейти в договор') + '">' +
      '<i class="ti ti-file-text"></i>' + escapeHtml(label) + '</span>'
    );
  }

  // v2.43.92: быстрое «Готово» прямо на карточке для открытых задач
  const quickDoneBtn = !isDone
    ? '<button class="task-quick-done" onclick="_tasksQuickDone(event,' + t.id + ')" title="Отметить готовой"><i class="ti ti-check"></i></button>'
    : '';
  return '<div class="task-row ' + (isDone ? 'task-done' : '') + '" onclick="openTaskDetail(' + t.id + ')">' +
    '<div class="task-row-priority ' + priorityCls + '"></div>' +
    '<div class="task-row-body">' +
      '<div class="task-row-title">' + escapeHtml(t.title) + '</div>' +
      (meta.length ? '<div class="task-row-meta">' + meta.join('') + '</div>' : '') +
    '</div>' +
    '<div class="task-status-pill ' + t.status + '">' + escapeHtml(t.status_label) + '</div>' +
    quickDoneBtn +
    '</div>';
}

// ЭТАП 16В-2: переход в договор из бейджа задачи
function openContractFromTask(contractId) {
  if (!contractId) return;
  state.currentContractId = contractId;
  selectSection('sales');
  selectSidebarItem('sales-contract-detail');
}

function formatTaskDeadline(iso) {
  if (!iso) return '';
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const diff = Math.round((d - today) / 86400000);
    if (diff === 0) return 'сегодня';
    if (diff === 1) return 'завтра';
    if (diff === -1) return 'вчера';
    if (diff < 0) return 'просрочен ' + Math.abs(diff) + ' дн.';
    if (diff < 7) return 'через ' + diff + ' дн.';
    return formatDateLong(iso);
  } catch (e) { return iso; }
}

// ---- «Назначенные мне» ----

async function loadTasksMine() {
  const container = document.getElementById('tasks-mine-content');
  container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const d = await apiGet('/api/tasks?assigned_to_me=1&status=open');
    if (!d.tasks || !d.tasks.length) {
      container.innerHTML = '<div class="empty-block"><i class="ti ti-user-check"></i>Назначенных вам задач нет</div>';
      return;
    }
    let html = '<div style="padding: 0 18px;">';
    d.tasks.forEach(t => { html += renderTaskRow(t); });
    html += '</div>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

// ---- «Поставленные мной» ----

async function loadTasksCreated() {
  const container = document.getElementById('tasks-created-content');
  container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const d = await apiGet('/api/tasks?mine=1&status=open');
    if (!d.tasks || !d.tasks.length) {
      container.innerHTML = '<div class="empty-block"><i class="ti ti-clipboard-plus"></i>Вы пока не создавали задач</div>';
      return;
    }
    let html = '<div style="padding: 0 18px;">';
    d.tasks.forEach(t => { html += renderTaskRow(t); });
    html += '</div>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

// ---- Карточка задачи ----

function openTaskDetail(taskId) {
  state.currentTaskId = taskId;
  selectSidebarItem('task-detail');
}

async function loadTaskDetail() {
  const tid = state.currentTaskId;
  const container = document.getElementById('task-detail-content');
  if (!tid) {
    container.innerHTML = '<div class="empty-block">Задача не выбрана</div>';
    return;
  }
  container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const t = await apiGet('/api/tasks/' + tid);
    renderTaskDetail(t);
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderTaskDetail(t) {
  document.getElementById('task-detail-title').textContent = t.title || '—';
  document.getElementById('task-detail-mob-title').textContent = t.title || 'Задача';
  const sub = [];
  if (t.assignee_name) sub.push('Исполнитель: ' + t.assignee_name);
  if (t.priority === 'urgent') sub.push('🔥 срочно');
  document.getElementById('task-detail-subtitle').textContent = sub.join(' · ') || '—';

  const container = document.getElementById('task-detail-content');
  const canEdit = canManageTasks();
  const myChatId = state.user && state.user.chat_id;
  const myEmpId = state.user && state.user.employee_id;
  const isCreator = t.creator_chat_id === myChatId;
  const isAssignee = t.assignee_id === myEmpId;
  const canChangeStatus = canEdit || isCreator || isAssignee;
  const canEditFully = canEdit || isCreator;

  // v2.43.93: цветной hero сверху + сегментированный switch + карточки-факты
  const status = t.status || 'new';
  const statusIcon = status === 'new' ? 'ti-sparkles' :
                     status === 'in_progress' ? 'ti-player-play' :
                     status === 'done' ? 'ti-circle-check' :
                     status === 'cancelled' ? 'ti-circle-x' : 'ti-circle';
  const prio = t.priority || 'normal';
  const prioMeta = prio === 'urgent' ? {icon: 'ti-flame', label: 'срочно', cls: 'urgent', factCls: 'c-red'} :
                   prio === 'low' ? {icon: 'ti-arrow-down', label: 'низкий', cls: '', factCls: 'c-green'} :
                                    {icon: 'ti-minus', label: 'обычный', cls: '', factCls: 'c-gray'};

  // Дедлайн с подсветкой
  let deadlineCls = '';
  let deadlineFactCls = 'c-gray';
  if (t.deadline) {
    try {
      const diff = Math.round((new Date(t.deadline) - new Date()) / 86400000);
      if (status !== 'done' && diff < 0) { deadlineCls = 'urgent'; deadlineFactCls = 'c-red'; }
      else if (status !== 'done' && diff <= 1) { deadlineCls = 'soon'; deadlineFactCls = 'c-orange'; }
      else { deadlineFactCls = 'c-violet'; }
    } catch (e) {}
  }

  let html = '<div class="task-detail-card">';

  // === HERO === цветной блок со статусом и приоритетом
  html += '<div class="task-detail-hero s-' + status + '">' +
            '<div class="task-detail-hero-label"><i class="ti ' + statusIcon + '"></i>СТАТУС</div>' +
            '<div class="task-detail-hero-status">' + escapeHtml(t.status_label || status) + '</div>' +
            '<div class="task-detail-hero-priority' + (prio === 'urgent' ? ' urgent' : '') + '">' +
              '<i class="ti ' + prioMeta.icon + '"></i>' +
              'Приоритет: ' + escapeHtml(t.priority_label || prioMeta.label) +
            '</div>' +
          '</div>';

  html += '<div class="task-detail-body">';

  // Переключатель статуса
  if (canChangeStatus) {
    html += '<div class="task-detail-status-row">';
    TASK_STATUSES.forEach(s => {
      const active = s.code === t.status;
      const extraCls = active ? (' active ' + s.code) : '';
      html += '<button class="task-detail-status-btn' + extraCls + '" onclick="changeTaskStatus(' + t.id + ', \'' + s.code + '\')">' +
        escapeHtml(s.label) + '</button>';
    });
    html += '</div>';
  }

  // Описание
  if (t.description) {
    html += '<div class="task-detail-description">' + escapeHtml(t.description).replace(/\n/g, '<br>') + '</div>';
  }

  // Карточки-факты
  html += '<div class="task-facts-grid">';
  // Исполнитель
  html += '<div class="task-fact">' +
            '<div class="task-fact-icon c-violet"><i class="ti ti-user"></i></div>' +
            '<div class="task-fact-body">' +
              '<div class="task-fact-label">Исполнитель</div>' +
              '<div class="task-fact-value' + (t.assignee_name ? '' : ' muted') + '">' +
                escapeHtml(t.assignee_name || 'не назначен') + '</div>' +
            '</div></div>';
  // Дедлайн
  html += '<div class="task-fact">' +
            '<div class="task-fact-icon ' + deadlineFactCls + '"><i class="ti ti-clock"></i></div>' +
            '<div class="task-fact-body">' +
              '<div class="task-fact-label">Дедлайн</div>' +
              '<div class="task-fact-value ' + deadlineCls + (t.deadline ? '' : ' muted') + '">' +
                escapeHtml(t.deadline ? formatTaskDeadline(t.deadline) : 'не указан') + '</div>' +
            '</div></div>';
  // Приоритет (дублируется в hero, но в фактах тоже наглядно)
  html += '<div class="task-fact">' +
            '<div class="task-fact-icon ' + prioMeta.factCls + '"><i class="ti ' + prioMeta.icon + '"></i></div>' +
            '<div class="task-fact-body">' +
              '<div class="task-fact-label">Приоритет</div>' +
              '<div class="task-fact-value">' + escapeHtml(t.priority_label || prioMeta.label) + '</div>' +
            '</div></div>';
  // Создана
  if (t.created_at) {
    html += '<div class="task-fact">' +
              '<div class="task-fact-icon c-gray"><i class="ti ti-calendar-plus"></i></div>' +
              '<div class="task-fact-body">' +
                '<div class="task-fact-label">Создана</div>' +
                '<div class="task-fact-value muted">' + escapeHtml(formatTaskDateTime(t.created_at)) + '</div>' +
              '</div></div>';
  }
  // Источник
  if (t.source) {
    html += '<div class="task-fact">' +
              '<div class="task-fact-icon c-orange"><i class="ti ti-tag"></i></div>' +
              '<div class="task-fact-body">' +
                '<div class="task-fact-label">Источник</div>' +
                '<div class="task-fact-value">' + escapeHtml(t.source) + '</div>' +
              '</div></div>';
  }
  // Завершена
  if (t.done_at) {
    html += '<div class="task-fact">' +
              '<div class="task-fact-icon c-green"><i class="ti ti-circle-check"></i></div>' +
              '<div class="task-fact-body">' +
                '<div class="task-fact-label">Завершена</div>' +
                '<div class="task-fact-value muted">' + escapeHtml(formatTaskDateTime(t.done_at)) + '</div>' +
              '</div></div>';
  }
  // Договор — на всю ширину
  if (t.contract_id && t.contract_number) {
    const archived = !t.contract_is_active;
    const lbl = t.contract_number + (t.contractor_name ? ' · ' + t.contractor_name : '');
    html += '<div class="task-fact span-2">' +
              '<div class="task-fact-icon"><i class="ti ti-file-text"></i></div>' +
              '<div class="task-fact-body">' +
                '<div class="task-fact-label">Договор' + (archived ? ' (в архиве)' : '') + '</div>' +
                '<div class="task-fact-value">' +
                  '<a href="#" class="contract-link" onclick="event.preventDefault(); openContractFromTask(' + t.contract_id + ')">' +
                    '<i class="ti ti-external-link"></i> ' + escapeHtml(lbl) +
                  '</a>' +
                '</div>' +
              '</div></div>';
  }
  html += '</div>'; // task-facts-grid

  // Действия
  if (canEditFully) {
    html += '<div style="display:flex; gap:8px; flex-wrap:wrap;">';
    html += '<button class="btn btn-secondary" onclick="openEditTask()"><i class="ti ti-edit"></i> Редактировать</button>';
    html += '<button class="btn btn-secondary" onclick="deleteCurrentTask()" style="color:var(--danger);"><i class="ti ti-trash"></i> Удалить</button>';
    html += '</div>';
  }

  html += '</div>';   // task-detail-body
  html += '</div>';   // task-detail-card

  container.innerHTML = html;
}

function formatTaskDateTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return iso; }
}

async function changeTaskStatus(taskId, newStatus) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/tasks/' + taskId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось изменить статус', 'error');
      return;
    }
    showToast('Статус изменён', 'success');
    cache.tasks = {};
    cache.myTasks = null;
    cache.homeKpi = null;
    cache.contractTasks = {};                          // ЭТАП 16В-2
    if (state.currentScreen === 'task-detail') loadTaskDetail();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function deleteCurrentTask() {
  if (!state.currentTaskId) return;
  if (!confirm('Удалить эту задачу?')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/tasks/' + state.currentTaskId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось удалить', 'error');
      return;
    }
    showToast('Задача удалена', 'success');
    cache.tasks = {};
    cache.myTasks = null;
    cache.contractTasks = {};                          // ЭТАП 16В-2
    selectSidebarItem('tasks-list');
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// ---- Форма задачи ----

// ===== Авто-черновик формы «Новая задача» =====
// Пока заполняешь форму, данные сохраняются в localStorage. Если случайно вышел
// или нажал «назад» — при следующем открытии «Новой задачи» черновик
// восстановится. Чистится при создании задачи или по кнопке «Очистить».
var TASK_DRAFT_KEY = 'atomus_task_draft';

function _saveTaskDraft() {
  try {
    if (state.taskFormMode === 'edit') return;  // черновики только для новой задачи
    const f = state.taskForm || {};
    const hasContent = (f.title && f.title.trim()) || (f.description && f.description.trim()) ||
      f.assignee_id || f.deadline || (f.source && f.source.trim()) || f.contract_id;
    if (!hasContent) { localStorage.removeItem(TASK_DRAFT_KEY); return; }
    localStorage.setItem(TASK_DRAFT_KEY, JSON.stringify({
      title: f.title || '', description: f.description || '',
      assignee_id: f.assignee_id || null, assignee_name: f.assignee_name || '',
      deadline: f.deadline || '', priority: f.priority || 'normal',
      source: f.source || '', contract_id: f.contract_id || null,
      contract_label: f.contract_label || '', _ts: Date.now(),
    }));
  } catch (_) {}
}

function _loadTaskDraft() {
  try {
    const raw = localStorage.getItem(TASK_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return (d && typeof d === 'object') ? d : null;
  } catch (_) { return null; }
}

function clearTaskDraft() {
  try { localStorage.removeItem(TASK_DRAFT_KEY); } catch (_) {}
  state.taskDraftRestored = false;
}

function discardTaskDraft() {
  clearTaskDraft();
  state.taskForm = {
    title: '', description: '', assignee_id: null, assignee_name: '',
    deadline: '', priority: 'normal', source: '',
    contract_id: null, contract_label: '',
  };
  if (state.currentScreen === 'task-form') renderTaskForm();
  showToast('Черновик очищен', 'info');
}

function openNewTask() {
  if (!canManageTasks()) {
    showToast('Создавать задачи может директор, зам или менеджер', 'error');
    return;
  }
  state.taskFormMode = 'new';
  state.currentTaskId = null;
  // ЭТАП 16В-2: если задача создаётся из карточки договора — подставим привязку
  const preContractId = state.taskFromContractId || null;
  const preContractLabel = state.taskFromContractLabel || '';
  state.taskFromContractId = null;
  state.taskFromContractLabel = '';
  state.taskForm = {
    title: '', description: '', assignee_id: null, assignee_name: '',
    deadline: '', priority: 'normal', source: '',
    contract_id: preContractId, contract_label: preContractLabel,
  };
  // Восстановление черновика — только для «чистой» новой задачи (не из договора)
  state.taskDraftRestored = false;
  if (!preContractId) {
    const draft = _loadTaskDraft();
    if (draft) {
      state.taskForm = {
        title: draft.title || '', description: draft.description || '',
        assignee_id: draft.assignee_id || null, assignee_name: draft.assignee_name || '',
        deadline: draft.deadline || '', priority: draft.priority || 'normal',
        source: draft.source || '',
        contract_id: draft.contract_id || null, contract_label: draft.contract_label || '',
      };
      state.taskDraftRestored = true;
    }
  }
  selectSidebarItem('task-form');
}

async function openEditTask() {
  state.taskFormMode = 'edit';
  if (!state.currentTaskId) return;
  try {
    const t = await apiGet('/api/tasks/' + state.currentTaskId);
    // ЭТАП 16В-2: загружаем привязку к договору
    const contractLabel = t.contract_id
      ? (t.contract_number + (t.contractor_name ? ' · ' + t.contractor_name : ''))
      : '';
    state.taskForm = {
      title: t.title || '',
      description: t.description || '',
      assignee_id: t.assignee_id,
      assignee_name: t.assignee_name || '',
      deadline: t.deadline || '',
      priority: t.priority || 'normal',
      source: t.source || '',
      contract_id: t.contract_id || null,
      contract_label: contractLabel,
    };
    selectSidebarItem('task-form');
  } catch (e) {
    showToast('Не удалось загрузить задачу', 'error');
  }
}

function cancelTaskForm() {
  if (state.taskFormMode === 'edit' && state.currentTaskId) {
    selectSidebarItem('task-detail');
  } else {
    selectSidebarItem('tasks-list');
  }
}

async function initTaskForm() {
  const isEdit = state.taskFormMode === 'edit';
  document.getElementById('task-form-title').textContent = isEdit ? 'Редактирование задачи' : 'Новая задача';
  document.getElementById('task-form-mob-title').textContent = isEdit ? 'Редактирование' : 'Новая задача';
  // ЭТАП 26.x фикс: сначала ждём загрузку сотрудников, потом рендерим форму
  // (раньше рендер шёл синхронно — dropdown оказывался пустой)
  await ensureEmployeesLoaded();
  renderTaskForm();
}

async function ensureEmployeesLoaded() {
  // ЭТАП 26.x фикс: пустой массив не считается валидным кэшем (пере-загружаем)
  if (cache.activeEmployees && cache.activeEmployees.length > 0) {
    console.log('[employees] кэш есть:', cache.activeEmployees.length);
    return;
  }
  try {
    console.log('[employees] загружаем /api/employees?include_inactive=true...');
    const d = await apiGet('/api/employees?include_inactive=true');
    console.log('[employees] получено:', d);
    const all = (d && d.employees) || [];
    cache.activeEmployees = all.filter(e => e.is_active);
    console.log('[employees] активных:', cache.activeEmployees.length);
  } catch (e) {
    console.error('[employees] ошибка загрузки:', e);
    cache.activeEmployees = null;
  }
}

function renderTaskForm() {
  const f = state.taskForm;
  const container = document.getElementById('task-form-content');
  let html = '<div class="sales-form">';

  // Восстановленный черновик — показываем плашку с возможностью очистить
  if (state.taskFormMode === 'new' && state.taskDraftRestored) {
    html += '<div class="task-draft-banner">' +
            '<i class="ti ti-history"></i>' +
            '<span>Восстановлен черновик незаконченной задачи.</span>' +
            '<button type="button" class="btn-link" onclick="discardTaskDraft()">Очистить</button>' +
            '</div>';
  }

  // Название
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-row cols-1"><div>' +
          '<label>Название задачи <span class="req">*</span></label>' +
          '<div style="display:flex;gap:6px;align-items:stretch;">' +
            '<input type="text" id="tf-title" value="' + escapeHtml(f.title) + '" maxlength="200" placeholder="Кратко: что нужно сделать" style="flex:1;">' +
            '<button type="button" id="tf-title-mic" class="mic-btn" onclick="_voiceToField(\'tf-title\', \'title\')" title="Надиктовать (Chrome/Edge)">' +
              '<i class="ti ti-microphone"></i>' +
            '</button>' +
          '</div>' +
          '</div></div>';
  html += '<div class="sales-form-row cols-1"><div>' +
          '<label>Описание <span class="hint" style="text-transform:none; font-weight:400; color:var(--text-light); font-size:11px;">(опционально)</span></label>' +
          '<div style="display:flex;gap:6px;align-items:stretch;">' +
            '<textarea id="tf-description" rows="3" placeholder="Подробности задачи" style="flex:1;">' + escapeHtml(f.description) + '</textarea>' +
            '<button type="button" id="tf-description-mic" class="mic-btn" onclick="_voiceToField(\'tf-description\', \'description\')" title="Надиктовать (Chrome/Edge)">' +
              '<i class="ti ti-microphone"></i>' +
            '</button>' +
          '</div>' +
          '</div></div>';
  html += '</div>';

  // Исполнитель + дедлайн
  html += '<div class="sales-form-section">';
  html += '<div class="sales-form-row">';
  html += '<div><label>Исполнитель</label>' + renderAssigneeSelect(f.assignee_id) + '</div>';
  html += '<div><label>Дедлайн <span class="hint" style="text-transform:none; font-weight:400; color:var(--text-light); font-size:11px;">(опционально)</span></label>' +
          '<input type="date" id="tf-deadline" value="' + escapeHtml(f.deadline) + '"></div>';
  html += '</div>';

  // ЭТАП 16В-2: привязка к договору (опционально)
  html += '<div class="sales-form-row cols-1"><div>' +
          '<label>Договор <span class="hint" style="text-transform:none; font-weight:400; color:var(--text-light); font-size:11px;">(опционально)</span></label>';
  if (f.contract_id) {
    html += '<div class="picker-display">' +
            '<div class="picker-display-value">' +
              '<i class="ti ti-file-text" style="color:var(--brand);"></i> ' +
              escapeHtml(f.contract_label || '№ ' + f.contract_id) +
            '</div>' +
            '<div class="picker-display-actions">' +
              '<button type="button" class="btn-link" onclick="openContractPickerForTask()">Сменить</button>' +
              '<button type="button" class="btn-link btn-link-danger" onclick="clearTaskContract()">Очистить</button>' +
            '</div>' +
          '</div>';
  } else {
    html += '<button type="button" class="btn btn-secondary picker-empty-btn" onclick="openContractPickerForTask()">' +
            '<i class="ti ti-link"></i> Привязать к договору' +
          '</button>';
  }
  html += '</div></div>';

  // Приоритет
  html += '<div class="sales-form-row cols-1"><div>' +
          '<label>Приоритет</label>' +
          '<div class="priority-row">';
  TASK_PRIORITIES.forEach(p => {
    const active = p.code === f.priority;
    html += '<button type="button" class="priority-btn' + (active ? ' active ' + p.code : '') + '" onclick="setTaskPriority(\'' + p.code + '\')">' +
            '<i class="ti ' + p.icon + '"></i>' + p.label + '</button>';
  });
  html += '</div></div></div>';

  // Источник
  html += '<div class="sales-form-row cols-1"><div>' +
          '<label>Источник <span class="hint" style="text-transform:none; font-weight:400; color:var(--text-light); font-size:11px;">(напр. «Планёрка 14.05.2026» или «Звонок клиента»)</span></label>' +
          '<input type="text" id="tf-source" value="' + escapeHtml(f.source) + '" placeholder="Откуда задача">' +
          '</div></div>';
  html += '</div>';

  // Кнопки
  html += '<div class="sales-action-bar">';
  html += '<button class="btn btn-secondary" onclick="cancelTaskForm()">Отмена</button>';
  html += '<button class="btn btn-primary" id="tf-submit" onclick="submitTaskForm()">' +
          '<i class="ti ti-check"></i> ' + (state.taskFormMode === 'edit' ? 'Сохранить' : 'Создать задачу') + '</button>';
  html += '</div>';
  html += '<div id="tf-error"></div>';

  html += '</div>';
  container.innerHTML = html;

  // Подвязка
  document.getElementById('tf-title').addEventListener('input', e => { state.taskForm.title = e.target.value; _saveTaskDraft(); });
  document.getElementById('tf-description').addEventListener('input', e => { state.taskForm.description = e.target.value; _saveTaskDraft(); });
  document.getElementById('tf-deadline').addEventListener('change', e => { state.taskForm.deadline = e.target.value; _saveTaskDraft(); });
  document.getElementById('tf-source').addEventListener('input', e => { state.taskForm.source = e.target.value; _saveTaskDraft(); });
  const assigneeSel = document.getElementById('tf-assignee');
  if (assigneeSel) {
    assigneeSel.addEventListener('change', e => {
      const v = e.target.value;
      state.taskForm.assignee_id = v ? parseInt(v) : null;
      const opt = assigneeSel.selectedOptions[0];
      state.taskForm.assignee_name = opt ? opt.textContent : '';
      _saveTaskDraft();
    });
  }
}

// v2.45.80: голосовой ввод текста в произвольное поле через Web Speech API.
// Жмёшь mic → говоришь → текст ДОПИСЫВАЕТСЯ в поле (не затирает). Жмёшь
// ещё раз — остановить. Хранение распознанного — в state.taskForm[stateKey],
// чтобы сохранилось при перерендере.
let _voiceRec = null;
function _voiceToField(fieldId, stateKey) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showToast('Голосовой ввод недоступен в этом браузере. Используй Chrome или Edge.', 'error');
    return;
  }
  const fld = document.getElementById(fieldId);
  const btn = document.getElementById(fieldId + '-mic');
  if (!fld) return;
  // Повторное нажатие — остановить
  if (_voiceRec && _voiceRec._fieldId === fieldId) {
    try { _voiceRec.stop(); } catch (_) {}
    return;
  }
  // Если запись активна на другом поле — остановим
  if (_voiceRec) { try { _voiceRec.stop(); } catch (_) {} _voiceRec = null; }

  const rec = new SR();
  rec.lang = 'ru-RU';
  // Одна фраза за нажатие — самый стабильный режим на мобильных. Continuous +
  // interim плодили дубли: некоторые мобильные движки кладут в КАЖДЫЙ результат
  // всю накопленную фразу, и их сумма давала «в общемв общем надо…».
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec._fieldId = fieldId;
  rec._baseText = fld.value || '';     // содержимое поля до этой диктовки (фиксируем 1 раз)
  rec.onresult = (ev) => {
    // Берём ТОЛЬКО последний результат — он содержит самую полную распознанную
    // фразу. И ПОДСТАВЛЯЕМ (base + фраза), а не дописываем — чтобы повторные
    // события одной сессии не плодили дубли.
    let phrase = '';
    try {
      const last = ev.results[ev.results.length - 1];
      phrase = ((last && last[0] && last[0].transcript) || '').replace(/\s+/g, ' ').trim();
    } catch (_) {}
    if (!phrase) return;
    const sep = (rec._baseText && !/\s$/.test(rec._baseText)) ? ' ' : '';
    const newText = rec._baseText + sep + phrase;
    fld.value = newText;
    if (state.taskForm && stateKey) { state.taskForm[stateKey] = newText; _saveTaskDraft(); }
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed') showToast('Дай разрешение на микрофон в браузере', 'error');
    else if (e.error === 'no-speech') showToast('Не услышал речь', 'info');
    else showToast('Ошибка голосового ввода: ' + (e.error || ''), 'error');
  };
  rec.onend = () => {
    if (btn) btn.classList.remove('recording');
    if (_voiceRec === rec) _voiceRec = null;
  };
  try {
    rec.start();
    _voiceRec = rec;
    if (btn) btn.classList.add('recording');
    showToast('Говорите фразу… (для длинного текста — по фразе за нажатие)', 'info');
  } catch (e) {
    showToast('Не удалось запустить запись', 'error');
  }
}

function renderAssigneeSelect(currentId) {
  const list = cache.activeEmployees || [];
  let html = '<select id="tf-assignee"><option value="">— не назначен —</option>';
  list.forEach(e => {
    const sel = (e.id === currentId) ? ' selected' : '';
    html += '<option value="' + e.id + '"' + sel + '>' + escapeHtml(e.full_name || e.short_name || '—') + '</option>';
  });
  html += '</select>';
  return html;
}

function setTaskPriority(p) {
  state.taskForm.priority = p;
  _saveTaskDraft();
  // Обновим только кнопки приоритета — без полной перерисовки
  document.querySelectorAll('.priority-row .priority-btn').forEach(b => {
    b.className = 'priority-btn';
  });
  // Подсветим выбранную: ищем по индексу в TASK_PRIORITIES
  const idx = TASK_PRIORITIES.findIndex(x => x.code === p);
  const btns = document.querySelectorAll('.priority-row .priority-btn');
  if (btns[idx]) btns[idx].className = 'priority-btn active ' + p;
}

async function submitTaskForm() {
  const errEl = document.getElementById('tf-error');
  const btn = document.getElementById('tf-submit');
  errEl.innerHTML = '';

  const f = state.taskForm;
  if (!f.title.trim()) {
    errEl.innerHTML = '<div class="sales-error">Укажите название задачи</div>';
    return;
  }

  const payload = {
    title: f.title.trim(),
    description: f.description.trim(),
    assignee_id: f.assignee_id || null,
    deadline: f.deadline || null,
    priority: f.priority || 'normal',
    source: f.source.trim(),
    contract_id: f.contract_id || null,        // ЭТАП 16В-2
  };

  const isEdit = state.taskFormMode === 'edit';
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Сохраняем…';

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const url = isEdit
      ? API_BASE + '/api/tasks/' + state.currentTaskId
      : API_BASE + '/api/tasks';
    const r = await fetch(url, {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      errEl.innerHTML = '<div class="sales-error">' + escapeHtml(d.message || 'Не удалось сохранить') + '</div>';
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-check"></i> ' + (isEdit ? 'Сохранить' : 'Создать задачу');
      return;
    }
    const created = await r.json();
    if (!isEdit) clearTaskDraft();   // задача создана — черновик больше не нужен
    showToast(isEdit ? 'Задача обновлена' : 'Задача создана', 'success');
    cache.tasks = {};
    cache.myTasks = null;
    cache.homeKpi = null;
    cache.contractTasks = {};                          // ЭТАП 16В-2: инвалидация задач договора
    state.currentTaskId = created.id;
    selectSidebarItem('task-detail');
  } catch (e) {
    errEl.innerHTML = '<div class="sales-error">Ошибка соединения: ' + escapeHtml(String(e)) + '</div>';
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> ' + (isEdit ? 'Сохранить' : 'Создать задачу');
  }
}

// ---- Виджет «Мои задачи» на главной ----

async function loadHomeMyTasks() {
  try {
    const d = await apiGet('/api/home/my-tasks');
    cache.myTasks = d;
    renderHomeMyTasks();
  } catch (e) {
    // тихо
  }
}

function renderHomeMyTasks() {
  const el = document.getElementById('home-tasks-block');
  if (!el) return;
  const d = cache.myTasks || { tasks: [], total_open: 0 };
  let html = '<div class="home-tasks-widget">';
  html += '<div class="htw-head">';
  html += '<i class="ti ti-checklist"></i>';
  html += '<div class="htw-title">Мои задачи · ' + (d.total_open || 0) + ' открытых</div>';
  html += '<a class="htw-link" onclick="goToSection(\'tasks\', \'tasks-mine\')">все →</a>';
  html += '</div>';
  if (!d.tasks || !d.tasks.length) {
    html += '<div class="htw-empty"><i class="ti ti-circle-check"></i>Нет активных задач</div>';
  } else {
    html += '<div class="htw-list">';
    d.tasks.forEach(t => { html += renderTaskRow(t); });
    html += '</div>';
  }
  html += '</div>';
  el.innerHTML = html;
}

// ============ КОНЕЦ ЭТАПА 16В ============

// ============================================================================
// ============ ЭТАП 16Г: ОТГРУЗКИ + АКТИВНОСТИ НА ГЛАВНОЙ ====================
// ============================================================================

cache.upcomingShipments = null;
cache.recentActivity = null;

// ЭТАП 31.4: блок «Договоры в работе» на главной приложения
async function loadHomeContractsProgress() {
  const el = document.getElementById('home-contracts-progress-block');
  if (!el) return;
  try {
    const d = await apiGet('/api/contracts-with-progress');
    cache.contractsWithProgress = d.contracts || [];
    renderHomeContractsProgress();
  } catch (e) {
    el.innerHTML = '';
  }
}

function renderHomeContractsProgress() {
  const el = document.getElementById('home-contracts-progress-block');
  if (!el) return;
  const list = cache.contractsWithProgress || [];
  if (!list.length) {
    el.innerHTML = '<div class="empty-block" style="padding:14px;"><i class="ti ti-briefcase-off"></i>Нет договоров в работе</div>';
    return;
  }
  let html = '<div style="padding: 0 0 8px;">';
  list.forEach(c => {
    html += renderContractProgressCard(c);
  });
  html += '</div>';
  el.innerHTML = html;
}


async function loadHomeShipments() {
  try {
    const d = await apiGet('/api/home/upcoming-shipments');
    cache.upcomingShipments = d;
    renderHomeShipments();
  } catch (e) {
    const el = document.getElementById('home-shipments-block');
    if (el) el.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить отгрузки</div>';
  }
}

function renderHomeShipments() {
  const el = document.getElementById('home-shipments-block');
  if (!el) return;
  const d = cache.upcomingShipments || { contracts: [] };
  const list = d.contracts || [];

  // Если список пустой и пользователь — мастер/etc — просто скрываем секцию
  if (!list.length) {
    const titleEl = document.getElementById('home-shipments-title');
    if (titleEl) titleEl.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  let html = '';
  list.forEach(c => { html += renderShipmentRow(c); });
  el.innerHTML = html;
}

function renderShipmentRow(c) {
  const diff = c.days_to_deadline;
  let cls = '';
  let pillText = '';
  if (diff !== null && diff !== undefined) {
    if (diff < 0) {
      cls = 'urgent';
      pillText = 'просрочен ' + Math.abs(diff) + ' дн.';
    } else if (diff === 0) {
      cls = 'urgent';
      pillText = 'сегодня';
    } else if (diff === 1) {
      cls = 'soon';
      pillText = 'завтра';
    } else if (diff <= 3) {
      cls = 'soon';
      pillText = 'через ' + diff + ' дн.';
    } else {
      pillText = 'через ' + diff + ' дн.';
    }
  }

  // Дата
  let dayNum = '—', dayMon = '';
  if (c.delivery_date) {
    try {
      const d = new Date(c.delivery_date);
      if (!isNaN(d.getTime())) {
        dayNum = d.getDate();
        const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
        dayMon = months[d.getMonth()];
      }
    } catch (e) {}
  }

  const meta = [];
  if (pillText) meta.push('<span class="sr-deadline-pill">' + escapeHtml(pillText) + '</span>');
  meta.push('<span>' + escapeHtml(c.status_label || '—') + '</span>');
  if (c.manager_name) meta.push('<span>· ' + escapeHtml(c.manager_name) + '</span>');

  return '<div class="shipment-row ' + cls + '" onclick="openContractDetail(' + c.id + ')">' +
    '<div class="sr-day-cell">' +
      '<div class="sr-day-num">' + escapeHtml(String(dayNum)) + '</div>' +
      '<div class="sr-day-month">' + escapeHtml(dayMon) + '</div>' +
    '</div>' +
    '<div class="sr-body">' +
      '<div class="sr-num">' + escapeHtml(c.number || '—') + '</div>' +
      '<div class="sr-contractor">' + escapeHtml(c.contractor_name || '—') + '</div>' +
      '<div class="sr-meta">' + meta.join('') + '</div>' +
    '</div></div>';
}

// ---- Лента активностей ----

// v2.7.6: коллапс ленты — показываем 4 свежих, остальное по клику
const HOME_ACTIVITY_COLLAPSED = 4;
state.homeActivityExpanded = false;

async function loadHomeActivity() {
  try {
    const d = await apiGet('/api/home/recent-activity');
    cache.recentActivity = d;
    renderHomeActivity();
  } catch (e) {
    const el = document.getElementById('home-activity-block');
    if (el) el.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить активности</div>';
  }
}

function renderHomeActivity() {
  const el = document.getElementById('home-activity-block');
  if (!el) return;
  const d = cache.recentActivity || { activity: [] };
  const list = d.activity || [];

  if (!list.length) {
    el.innerHTML = '<div class="activity-feed"><div class="activity-empty">' +
                   '<i class="ti ti-history" style="display:block; font-size:28px; color:var(--text-faint); margin-bottom:6px;"></i>' +
                   'Пока активностей нет</div></div>';
    return;
  }

  const total = list.length;
  const expanded = !!state.homeActivityExpanded;
  const shown = expanded ? list : list.slice(0, HOME_ACTIVITY_COLLAPSED);
  const hiddenCount = total - shown.length;

  let html = '<div class="activity-feed">';
  shown.forEach(a => {
    // ЭТАП 31.10: чистка от JSON-мусора в text (страховка от старых записей в БД)
    const cleanText = _cleanActivityText(a.text || '');
    html += '<div class="activity-row">' +
      '<div class="ar-icon"><i class="ti ' + escapeHtml(a.icon || 'ti-circle') + '"></i></div>' +
      '<div class="ar-body">' +
        '<div class="ar-text">' + escapeHtml(cleanText) + '</div>' +
        '<div class="ar-time">' + escapeHtml(formatActivityTime(a.created_at)) + '</div>' +
      '</div></div>';
  });

  // Кнопка «Показать ещё» / «Свернуть» — только если есть что разворачивать
  if (total > HOME_ACTIVITY_COLLAPSED) {
    if (!expanded) {
      html += '<button type="button" class="activity-toggle" onclick="toggleHomeActivity()">' +
                '<i class="ti ti-chevron-down"></i> Показать ещё (' + hiddenCount + ')' +
              '</button>';
    } else {
      html += '<button type="button" class="activity-toggle" onclick="toggleHomeActivity()">' +
                '<i class="ti ti-chevron-up"></i> Свернуть' +
              '</button>';
    }
  }
  html += '</div>';
  el.innerHTML = html;
}

function toggleHomeActivity() {
  state.homeActivityExpanded = !state.homeActivityExpanded;
  renderHomeActivity();
}

// ЭТАП 31.10: убираем JSON-объекты из текста активности (старые записи в БД)
function _cleanActivityText(text) {
  if (!text) return '';
  let s = String(text);
  // Убираем JSON-объекты вида «{...}» или просто {...} — заменяем на читаемое
  s = s.replace(/«\s*\{[^}]*\}\s*»/g, '').replace(/\{[^{}]*"[^{}]*\}/g, '');
  // Сжимаем пробелы
  s = s.replace(/\s+/g, ' ').trim();
  // Убираем висящие пустые кавычки/тире
  s = s.replace(/«\s*»/g, '').replace(/\s*·\s*$/, '').trim();
  return s;
}

function formatActivityTime(iso) {
  if (!iso) return '';
  try {
    // SQLite отдаёт UTC время в формате "2026-05-14 09:30:15"
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return 'только что';
    if (diffMin < 60) return diffMin + ' мин. назад';
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return diffH + ' ч. назад';
    const diffD = Math.round(diffH / 24);
    if (diffD < 7) return diffD + ' дн. назад';
    // Иначе показываем дату
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  } catch (e) { return iso; }
}

// ============ КОНЕЦ ЭТАПА 16Г ============

// ============ МОДЕЛИ ============

async function loadModels() {
  const container = document.getElementById('models-list');
  // ЭТАП 30.6: показ кнопки «Новая модель» для директора/зама
  // ЭТАП 44: + кнопка «Новый раздел» (те же права)
  const canEdit = (typeof canManageSales === 'function') ? canManageSales() : false;
  const btnDesktop = document.getElementById('models-new-btn');
  const btnMobile = document.getElementById('models-mobile-new');
  const btnDirDesktop = document.getElementById('models-new-dir-btn');
  const btnDirMobile = document.getElementById('models-mobile-new-dir');
  const btnImportBom = document.getElementById('models-import-bom-btn');
  const btnClimate = document.getElementById('models-climate-setup-btn');
  const btnPanels = document.getElementById('models-panels-setup-btn');
  if (btnDesktop) btnDesktop.style.display = canEdit ? '' : 'none';
  if (btnMobile) btnMobile.style.display = canEdit ? '' : 'none';
  if (btnDirDesktop) btnDirDesktop.style.display = canEdit ? '' : 'none';
  if (btnDirMobile) btnDirMobile.style.display = canEdit ? '' : 'none';
  if (btnImportBom) btnImportBom.style.display = canEdit ? '' : 'none';
  if (btnClimate) btnClimate.style.display = canEdit ? '' : 'none';
  if (btnPanels) btnPanels.style.display = canEdit ? '' : 'none';

  if (cache.models) { renderModels(cache.models); return; }
  container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try { const d = await apiGet('/api/models?with_stock=true'); cache.models = d; renderModels(d); }
  catch (e) { container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>'; }
}

// v2.41.10: иконка и палитра подгруппы по её имени/коду
// v2.45.75: проверку «нерж/AISI» ставим первой — чтобы категория вроде
// «Воздухоохладители из нержавеющей стали» получила розово-стальную тему
// (а не teal от «воздухоохл»).
function _subgroupTheme(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('нерж') || n.includes('aisi'))      return { icon: 'ti-shield-check',     cls: 'sg-aisi' };
  if (n.includes('наружн')) return { icon: 'ti-building-broadcast-tower', cls: 'sg-outdoor' };
  if (n.includes('воздухоохл')) return { icon: 'ti-snowflake',           cls: 'sg-evaporator' };
  if (n.includes('донагрев') || n.startsWith('нпв')) return { icon: 'ti-flame', cls: 'sg-heater' };
  if (n.includes('увлаж'))    return { icon: 'ti-droplet',                cls: 'sg-humid' };
  if (n.includes('дефрост'))  return { icon: 'ti-temperature-snow',       cls: 'sg-defrost' };
  if (n.includes('чиллер'))   return { icon: 'ti-thermometer',            cls: 'sg-chiller' };
  if (n.includes('влагозащ') || n.includes(' ip'))   return { icon: 'ti-droplet-half-2',   cls: 'sg-ip' };
  if (n === 'стандарт' || n.startsWith('стандарт'))  return { icon: 'ti-package',          cls: 'sg-standard' };
  return { icon: 'ti-folder', cls: 'sg-default' };
}

// v2.45.75: переименовать категорию каталога моделей.
async function _renameCategoryPrompt(categoryId, currentName) {
  const name = prompt('Новое имя категории:', currentName || '');
  if (!name || !name.trim()) return;
  if (name.trim() === (currentName || '').trim()) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/admin/categories/' + categoryId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || ('HTTP ' + r.status), 'error');
      return;
    }
    showToast('Категория переименована', 'success');
    cache.models = null;
    if (typeof loadModels === 'function') {
      try { await loadModels(); } catch (e) {}
    }
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

// v2.45.65: создать новую категорию внутри направления (с поясняющим
// «в подгруппе X»). После успеха каталог перечитываем — категория появится
// как ещё одна сворачиваемая ветка внутри той же подгруппы, когда туда
// будет привязана хотя бы одна модель. Сразу после создания она пустая.
async function openCreateCategoryPrompt(directionId, subgroupId, subgroupName) {
  const name = prompt('Имя новой категории в подгруппе «' + subgroupName + '»:', '');
  if (!name || !name.trim()) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/admin/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        direction_id: directionId,
        subgroup_id: subgroupId || null,
        name: name.trim(),
      }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || ('HTTP ' + r.status), 'error');
      return;
    }
    const d = await r.json();
    showToast('Категория «' + d.name + '» создана', 'success');
    // Перезагружаем каталог
    cache.models = null;
    if (typeof loadModels === 'function') loadModels();
  } catch (e) { showToast('Ошибка', 'error'); }
}

// v2.45.196: удалить подгруппу. Модели из неё переезжают в «Без подгруппы»
// (не удаляются), категории-потомки открепляются. Для чистки лишних подгрупп.
async function deleteSubgroupPrompt(subgroupId, name, count) {
  const msg = count > 0
    ? 'Удалить подгруппу «' + name + '»?\n\n' + count + ' модель(ей) переедут в «Без подгруппы» (НЕ удалятся) — потом сможешь разложить их по нужным группам.'
    : 'Удалить пустую подгруппу «' + name + '»?';
  if (!confirm(msg)) return;
  try {
    await apiDelete('/api/subgroups/' + subgroupId);
    showToast('Подгруппа «' + name + '» удалена', 'success');
    cache.models = null;
    if (typeof loadModels === 'function') loadModels();
  } catch (e) { showToast(e.message || 'Ошибка удаления', 'error'); }
}

function renderModels(d) {
  const container = document.getElementById('models-list');
  if (!d.models || d.models.length === 0) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-package"></i>Моделей нет</div>'; return;
  }
  // ЭТАП 45.1: возможность редактировать/дублировать разделы
  const canEdit = (typeof canManageSales === 'function') ? canManageSales() : false;
  const dirMap = {};
  d.directions.forEach(dir => { dirMap[dir.id] = dir; });
  const groups = {};
  d.models.forEach(m => {
    const dirId = m.direction_id || 0;
    if (!groups[dirId]) groups[dirId] = [];
    groups[dirId].push(m);
  });
  // ЭТАП 44 FIX: показываем и пустые разделы (без моделей) — иначе только что
  // созданный раздел не виден в UI, пока туда не добавишь хотя бы одну модель
  d.directions.forEach(dir => {
    if (!groups[dir.id]) groups[dir.id] = [];
  });
  // ЭТАП 30.6 + 31.7: сворачиваемые группы. Внутри направления — подгруппы тоже сворачиваемые.
  const openMap = JSON.parse(localStorage.getItem('models_groups_open') || '{}');
  const openSubMap = JSON.parse(localStorage.getItem('models_subgroups_open') || '{}');
  let html = '';
  const dirIds = Object.keys(groups).sort((a, b) => Number(a) - Number(b));
  dirIds.forEach(dirId => {
    const dir = dirMap[dirId];
    const dirName = dir ? dir.name : '—';
    const dirNamePretty = _nvCapitalize(dirName);
    const palCls = _nvPaletteClass(dir ? (dir.code || dir.name) : dirId);
    const iconCls = _nvIconFor(dirName);
    const models = groups[dirId];
    // По умолчанию: если групп >= 2 — все свёрнуты; если одна — раскрыта.
    const defaultOpen = (dirIds.length === 1);
    const isOpen = (dirId in openMap) ? !!openMap[dirId] : defaultOpen;

    // Разбиваем модели направления на подгруппы
    const bySubgroup = {};
    const withoutSubgroup = [];
    models.forEach(m => {
      if (m.subgroup_id) {
        const sid = String(m.subgroup_id);
        // v2.45.66: храним id подгруппы — нужно для кнопки «+ Категория»
        if (!bySubgroup[sid]) bySubgroup[sid] = { id: m.subgroup_id, name: m.subgroup_name || ('Подгруппа #' + sid), items: [] };
        bySubgroup[sid].items.push(m);
      } else {
        withoutSubgroup.push(m);
      }
    });
    const subgroupKeys = Object.keys(bySubgroup).sort((a, b) => {
      // сортируем по name (там 001.0 / 002.0)
      return (bySubgroup[a].name || '').localeCompare(bySubgroup[b].name || '');
    });
    const hasSubgroups = subgroupKeys.length > 0;

    html +=
      '<div class="models-group">' +
        '<div class="models-group-toggle ' + palCls + '" role="button" tabindex="0" onclick="toggleModelsGroup(\'' + dirId + '\')">' +
          '<i class="ti ti-chevron-right models-group-chevron' + (isOpen ? ' open' : '') + '"></i>' +
          '<span class="nv-group-icon"><i class="ti ' + iconCls + '"></i></span>' +
          '<span class="models-group-name">' + escapeHtml(dirNamePretty) + '</span>' +
          '<span class="models-group-count">' + models.length + '</span>' +
          (canEdit && dir ?
            '<span class="dir-actions-desktop" style="display:inline-flex;gap:4px;" onclick="event.stopPropagation()">' +
              '<span role="button" tabindex="0" class="icon-btn" title="Переименовать раздел" onclick="event.stopPropagation();openEditDirectionModal(' + dir.id + ')" style="padding:4px 6px;display:inline-flex;align-items:center;cursor:pointer;border-radius:6px;"><i class="ti ti-edit" style="font-size:14px;"></i></span>' +
              '<span role="button" tabindex="0" class="icon-btn" title="Дублировать раздел" onclick="event.stopPropagation();openDuplicateDirectionModal(' + dir.id + ')" style="padding:4px 6px;display:inline-flex;align-items:center;cursor:pointer;border-radius:6px;"><i class="ti ti-copy" style="font-size:14px;"></i></span>' +
              '<span role="button" tabindex="0" class="icon-btn" title="Удалить раздел" onclick="event.stopPropagation();openDeleteDirectionModal(' + dir.id + ')" style="padding:4px 6px;display:inline-flex;align-items:center;cursor:pointer;border-radius:6px;color:var(--danger);"><i class="ti ti-trash" style="font-size:14px;"></i></span>' +
            '</span>' +
            '<button class="dir-kebab-btn" title="Действия" onclick="event.stopPropagation();openDirectionKebabMenu(this, ' + dir.id + ')"><i class="ti ti-dots-vertical"></i></button>'
            : '') +
        '</div>' +
        '<div class="models-group-body" data-dirid="' + dirId + '" style="' + (isOpen ? '' : 'display:none;') + '">';

    // Сначала модели «без подгруппы»
    if (withoutSubgroup.length) {
      if (hasSubgroups) {
        // Если есть подгруппы — отдельный сворачиваемый блок «Без подгруппы»
        const subKey = dirId + ':none';
        const subOpen = subKey in openSubMap ? !!openSubMap[subKey] : true;
        html += '<div class="models-subgroup">' +
          '<button class="models-subgroup-toggle" data-subkey="' + subKey + '" onclick="toggleModelsSubgroup(\'' + subKey + '\')">' +
            '<i class="ti ti-chevron-right models-subgroup-chevron' + (subOpen ? ' open' : '') + '"></i>' +
            '<span>Без подгруппы</span>' +
            '<span class="models-subgroup-count">' + withoutSubgroup.length + '</span>' +
          '</button>' +
          '<div class="models-subgroup-body" data-subkey="' + subKey + '" style="' + (subOpen ? '' : 'display:none;') + '">' +
            '<div class="card">';
        withoutSubgroup.forEach(m => { html += _renderModelRow(m); });
        html += '</div></div></div>';
      } else {
        // Если нет подгрупп — рендерим как обычно одной картой
        html += '<div class="card">';
        withoutSubgroup.forEach(m => { html += _renderModelRow(m); });
        html += '</div>';
      }
    }

    // Затем подгруппы (level 1). v2.45.55: внутри каждой подгруппы группируем
    // модели по category_id (level 2) — двухуровневая иерархия каталога.
    subgroupKeys.forEach(sid => {
      const sg = bySubgroup[sid];
      const subKey = dirId + ':' + sid;
      const subOpen = subKey in openSubMap ? !!openSubMap[subKey] : false;
      const theme = _subgroupTheme(sg.name);
      // Группируем модели подгруппы по категориям
      const byCat = {};
      const noCat = [];
      sg.items.forEach(m => {
        if (m.category_id) {
          const cid = String(m.category_id);
          if (!byCat[cid]) byCat[cid] = { id: m.category_id, name: m.category_name || ('Категория #' + m.category_id), items: [] };
          byCat[cid].items.push(m);
        } else {
          noCat.push(m);
        }
      });
      // v2.45.66: показываем ПУСТЫЕ категории, привязанные к этой подгруппе
      // (их в d.categories отдаёт сервер с parent_subgroup_id).
      const subId = sg.id;
      (d.categories || []).forEach(cat => {
        if (cat.parent_subgroup_id !== subId) return;
        const cidStr = String(cat.id);
        if (!byCat[cidStr]) {
          byCat[cidStr] = { id: cat.id, name: cat.name, items: [] };
        }
      });
      const catKeys = Object.keys(byCat).sort((a, b) =>
        (byCat[a].name || '').localeCompare(byCat[b].name || ''));
      const hasCategories = catKeys.length > 0;
      // v2.45.66: button нельзя класть внутрь button — HTML невалиден,
      // браузер ломает DOM и выкидывает inner button наружу. Поэтому шапка
      // подгруппы теперь — div с теми же классами, ведёт себя как кнопка
      // через onclick. Кнопка «+ Категория» лежит рядом, не вложена.
      const addCatBtn = canEdit
        ? '<button class="models-add-cat-btn" title="Создать категорию внутри подгруппы" ' +
            'onclick="event.stopPropagation();openCreateCategoryPrompt(' + dirId + ',' + sg.id + ',\'' + escapeHtml(sg.name).replace(/'/g, "\\'") + '\')">' +
            '<i class="ti ti-folder-plus"></i><span class="acb-label">Категория</span>' +
          '</button>'
        : '';
      // v2.45.196: удалить подгруппу (модели переезжают в «Без подгруппы», не удаляются)
      const delSgBtn = canEdit
        ? '<button class="models-add-cat-btn" style="border-color:var(--danger);color:var(--danger);" ' +
            'title="Удалить подгруппу (модели переедут в «Без подгруппы»)" ' +
            'onclick="event.stopPropagation();deleteSubgroupPrompt(' + sg.id + ',\'' + escapeHtml(sg.name).replace(/'/g, "\\'") + '\',' + sg.items.length + ')">' +
            '<i class="ti ti-trash"></i>' +
          '</button>'
        : '';
      html += '<div class="models-subgroup ' + theme.cls + '">' +
        '<div class="models-subgroup-toggle" role="button" tabindex="0" data-subkey="' + subKey + '" onclick="toggleModelsSubgroup(\'' + subKey + '\')">' +
          '<i class="ti ti-chevron-right models-subgroup-chevron' + (subOpen ? ' open' : '') + '"></i>' +
          '<i class="ti ' + theme.icon + ' sg-icon"></i>' +
          '<span class="sg-name">' + escapeHtml(sg.name) + '</span>' +
          '<span class="models-subgroup-count">' + sg.items.length + '</span>' +
          addCatBtn + delSgBtn +
        '</div>' +
        '<div class="models-subgroup-body" data-subkey="' + subKey + '" style="' + (subOpen ? '' : 'display:none;') + '">';
      // Без категории — карточкой как раньше
      if (noCat.length) {
        html += '<div class="card">';
        noCat.forEach(m => { html += _renderModelRow(m); });
        html += '</div>';
      }
      // Категории внутри подгруппы — отдельный сворачиваемый блок
      catKeys.forEach(cid => {
        const cat = byCat[cid];
        const catKey = subKey + ':cat:' + cid;
        const catOpen = catKey in openSubMap ? !!openSubMap[catKey] : false;
        // v2.45.75: цветовая тема категории по имени (нерж → розовая и т.д.)
        const catTheme = _subgroupTheme(cat.name);
        const isThemed = catTheme.cls !== 'sg-default';
        // Для тёмной темы (aisi и т.п.) убираем светло-серый фон, чтобы
        // подсветка пришла через models-subgroup.<cls>.
        const catRowBg = isThemed ? '' : 'background:#F8FAFC;';
        const renameBtn = (typeof canManageSales === 'function' && canManageSales())
          ? '<button class="dev-link-btn" onclick="event.stopPropagation(); _renameCategoryPrompt(' + cid + ', ' + JSON.stringify(cat.name).replace(/"/g, '&quot;') + ')" ' +
              'title="Переименовать категорию" style="margin-left:6px;padding:2px 6px;">' +
              '<i class="ti ti-edit"></i>' +
            '</button>'
          : '';
        html += '<div class="models-category models-subgroup ' + catTheme.cls + '" style="margin:6px 0 0 14px;">' +
          '<div class="models-subgroup-toggle" role="button" tabindex="0" data-subkey="' + catKey + '" onclick="toggleModelsSubgroup(\'' + catKey + '\')" style="padding-left:10px;' + catRowBg + '">' +
            '<i class="ti ti-chevron-right models-subgroup-chevron' + (catOpen ? ' open' : '') + '"></i>' +
            '<i class="ti ' + catTheme.icon + ' sg-icon"' + (isThemed ? '' : ' style="opacity:0.7;"') + '></i>' +
            '<span class="sg-name" style="font-size:13.5px;">' + escapeHtml(cat.name) + '</span>' +
            '<span class="models-subgroup-count">' + cat.items.length + '</span>' +
            renameBtn +
          '</div>' +
          '<div class="models-subgroup-body" data-subkey="' + catKey + '" style="' + (catOpen ? '' : 'display:none;') + '">' +
            '<div class="card">';
        cat.items.forEach(m => { html += _renderModelRow(m); });
        html += '</div></div></div>';
      });
      html += '</div></div>';
    });

    html += '</div></div>';
  });
  container.innerHTML = html;
}

// v2.41.10: подсветка слов «AISI» / «Нерж» в названиях моделей и компонентов
function _highlightAisi(text) {
  if (!text) return '';
  const escaped = escapeHtml(text);
  return escaped
    .replace(/(AISI)/g, '<span class="lbl-aisi">$1</span>')
    .replace(/(Нерж\.?(?:\s*AISI)?)/gi, m => '<span class="lbl-aisi">' + m + '</span>');
}

function _renderModelRow(m) {
  const title = m.name + (m.extra ? ' · ' + m.extra : '');
  const isAisi = ((m.name || '').toUpperCase().includes('AISI')) ||
                 ((m.exec_fixed || '').toLowerCase().startsWith('нерж'));
  const meta = [];
  if (m.article) meta.push(m.article);
  if (m.exec_mode === 'choice') meta.push('испол.: ' + m.exec_label_st + ' / ' + m.exec_label_ne);
  else if (m.exec_mode === 'fixed' && m.exec_fixed) meta.push('испол.: ' + m.exec_fixed);
  if (m.needs_ip) meta.push('IP');
  const inactiveCls = m.is_active ? '' : ' emp-inactive';
  const aisiRowCls = isAisi ? ' model-row-aisi' : '';
  let stockBadges = '';
  if (typeof m.assemblies_ready === 'number') {
    if (m.assemblies_ready > 0) {
      stockBadges += '<span class="model-badge mb-stock" title="Готовых сборок на складе"><i class="ti ti-package"></i>В наличии: ' + m.assemblies_ready + '</span>';
    }
    if (m.assemblies_reserved > 0) {
      stockBadges += '<span class="model-badge mb-reserved" title="Зарезервировано под договоры"><i class="ti ti-lock"></i>Резерв: ' + m.assemblies_reserved + '</span>';
    }
    if (m.bom_shortage > 0) {
      stockBadges += '<span class="model-badge mb-shortage" title="Комплектующих в дефиците для сборки"><i class="ti ti-shopping-cart"></i>К закупке: ' + m.bom_shortage + '</span>';
    } else if (m.bom_total > 0 && m.assemblies_ready === 0) {
      stockBadges += '<span class="model-badge mb-ready" title="Все комплектующие в наличии — можно собирать"><i class="ti ti-tool"></i>К сборке</span>';
    }
  }
  return '<div class="employee-row' + inactiveCls + aisiRowCls + '" style="cursor:pointer;" onclick="openModelDetail(' + m.id + ')">' +
    '<div class="emp-info"><div class="emp-name">' + _highlightAisi(title) + '</div>' +
    '<div class="emp-meta">' + _highlightAisi(meta.join(' · ') || '—') +
      (stockBadges ? '<div class="model-badges-row">' + stockBadges + '</div>' : '') +
    '</div></div>' +
    '<div style="color:var(--text-light);font-size:18px;"><i class="ti ti-chevron-right"></i></div>' +
    '</div>';
}

// ============ ЭТАП 32: Карточка модели с тех. картой ============

async function openModelDetail(modelId) {
  // ЭТАП 45 (v2.33.0): нужны актуальные поля модели (specs_json, image_path, prices, nc_code).
  // Грузим деталь напрямую через GET /api/models/{id}/bom — он только BOM, поля модели в нём нет.
  // Поэтому возьмём из cache.models, но если кэш устарел или нет поля — освежим.
  let m = ((cache.models && cache.models.models) || []).find(x => x.id === modelId);
  if (!m) {
    // Освежаем кэш — возможно модель только что создана через promote
    try {
      const d = await apiGet('/api/models?with_stock=true');
      cache.models = d;
      m = (d.models || []).find(x => x.id === modelId);
    } catch (e) {}
  }
  if (!m) { showToast('Модель не найдена', 'error'); return; }
  // Поля promote (specs_json/image_path/prices/nc_code) в /api/models нет —
  // нужен прямой запрос за полной строкой. Используем простой обходной путь:
  // получим напрямую из БД через отдельный endpoint... которого нет.
  // PATCH-эндпоинт возвращает полную модель. Сделаем GET через хак: PATCH с пустым body вернёт ошибку.
  // Решение: добавим в /api/models поля promote → уже сделано в _serialize... СТОП, в get_models
  // полей promote НЕТ. Чтобы не ломать структуру списка, попробуем достать поля из бэка
  // через простой GET. Если нет — попросим бэк отдавать их в /api/models тоже.
  // Пока что: используем поля что есть в m (m.specs_json, m.image_path, m.base_price...)
  // которых может не быть, и для отображения берём пусто.
  state._currentBomModelId = modelId;

  let overlay = document.getElementById('model-detail-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'model-detail-modal';
    overlay.className = 'modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) closeModelDetail(); };
    document.body.appendChild(overlay);
  }

  const dir = ((cache.models && cache.models.directions) || []).find(d => d.id === m.direction_id);
  const dirName = dir ? dir.name : '—';
  const subParts = [m.article];
  if (m.exec_mode === 'choice') subParts.push('испол.: ' + m.exec_label_st + ' / ' + m.exec_label_ne);
  else if (m.exec_mode === 'fixed' && m.exec_fixed) subParts.push('испол.: ' + m.exec_fixed);
  if (m.needs_ip) subParts.push('IP-класс');

  // ЭТАП 45: цены, НС-код, картинка, характеристики (если есть)
  const retail = (m.base_price != null && m.base_price !== '') ? _fmtMoney(m.base_price) + ' ₽' : '';
  const dealer = (m.dealer_price != null && m.dealer_price !== '') ? _fmtMoney(m.dealer_price) + ' ₽' : '';
  const nc = m.nc_code || '';

  let pricesHtml = '';
  if (retail || dealer || nc) {
    pricesHtml = '<div class="sp-detail-prices" style="margin-bottom:18px;">';
    if (retail) {
      pricesHtml += '<div class="sp-detail-price-item">' +
        '<div class="sp-detail-price-label">Розничная</div>' +
        '<div class="sp-detail-price-value retail">' + retail + '</div></div>';
    }
    if (dealer) {
      pricesHtml += '<div class="sp-detail-price-item">' +
        '<div class="sp-detail-price-label">Дилерская</div>' +
        '<div class="sp-detail-price-value dealer">' + dealer + '</div></div>';
    }
    if (nc) {
      pricesHtml += '<div class="sp-detail-price-item">' +
        '<div class="sp-detail-price-label">НС-код</div>' +
        '<div class="sp-detail-price-value" style="font-family:monospace;font-size:14px;">' + escapeHtml(nc) + '</div></div>';
    }
    pricesHtml += '</div>';
  }

  // Картинка из связанной продажной (или из самой модели если поле есть)
  // v2.45.228: + кнопка удаления (можно убрать у всех моделей с такой же картинкой)
  let imgHtml = '';
  if (m.image_path) {
    imgHtml = '<div class="sp-detail-image" style="margin-bottom:14px;position:relative;">' +
      '<img src="' + API_BASE + '/static/images/' + escapeHtml(m.image_path) + '" ' +
        'alt="' + escapeHtml(m.name) + '" ' +
        'onerror="this.parentNode.style.display=\'none\'" />' +
      (canManageSales() ?
        '<button onclick="deleteModelImage(' + modelId + ')" title="Убрать картинку" ' +
          'style="position:absolute;top:8px;right:8px;width:30px;height:30px;border-radius:50%;border:1px solid var(--border);background:rgba(255,255,255,0.95);color:var(--danger);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.15);">' +
          '<i class="ti ti-trash"></i></button>' : '') +
    '</div>';
  }

  // Характеристики (specs) — legacy простой объект {key: value}
  let specsHtml = '';
  let specsObj = {};
  if (m.specs_json) {
    try { specsObj = JSON.parse(m.specs_json) || {}; } catch (e) { specsObj = {}; }
  } else if (m.specs && typeof m.specs === 'object') {
    specsObj = m.specs;
  }
  if (Object.keys(specsObj).length) {
    specsHtml = '<div class="sp-detail-specs" style="margin-bottom:18px;">' +
      '<div class="sp-detail-section-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
        '<span><i class="ti ti-list-details"></i> Характеристики</span>' +
        // v2.45.219: правка характеристик (параметров) прямо из карточки —
        // открывает форму модели, где их можно добавить/изменить/удалить.
        (canManageSales() ? '<button class="btn btn-secondary btn-small" onclick="openEditModelModal(' + modelId + ')" title="Редактировать характеристики"><i class="ti ti-edit"></i> Редактировать</button>' : '') +
      '</div>';
    Object.keys(specsObj).forEach(k => {
      specsHtml += '<div class="sp-spec-row">' +
        '<div class="sp-spec-key">' + escapeHtml(k) + '</div>' +
        '<div class="sp-spec-val">' + escapeHtml(specsObj[k]) + '</div>' +
      '</div>';
    });
    specsHtml += '</div>';
  }

  // v2.43.85: новый блок «Характеристики (секции)» — структурированный, с фото и
  // загрузкой/AI-разбором файла спецификации.
  const charsHtml = _renderModelCharsBlock(m);

  // Описание
  let descHtml = '';
  if (m.description) {
    descHtml = '<div style="background:var(--bg);border-radius:8px;padding:12px 14px;margin-bottom:18px;font-size:13px;color:var(--text-dark);white-space:pre-wrap;">' +
      escapeHtml(m.description) + '</div>';
  }

  // Бейдж "Перенесено из продажной"
  let sourceBadge = '';
  if (m.source_sale_product_id) {
    sourceBadge =
      '<div style="background:var(--brand-bg);border:1px solid var(--brand);border-radius:8px;padding:8px 12px;margin-bottom:14px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--brand);">' +
        '<i class="ti ti-package-import" style="font-size:16px;"></i>' +
        '<span>Создано из продажной позиции #' + m.source_sale_product_id + '</span>' +
      '</div>';
  }

  // v2.43.86: кнопка «Изменить модель» теперь в шапке рядом с названием —
  // раньше она лежала среди BOM-кнопок и многие думали что это редактирование BOM.
  const editBtn = canManageSales()
    ? '<button class="btn btn-secondary btn-small" onclick="openEditModelModal(' + modelId + ')" title="Изменить название, описание, исполнение"><i class="ti ti-edit"></i> Изменить модель</button>'
    : '';
  // v2.41.13: кнопка «Раздвоить» для choice-моделей (только директор/зам)
  const splitBtn = (canManageSales() && m.exec_mode === 'choice')
    ? '<button class="btn btn-secondary btn-small" onclick="splitModelExecution(' + modelId + ')" title="Создать вторую модель — копию с пометкой AISI">' +
        '<i class="ti ti-arrows-split-2"></i> Раздвоить' +
      '</button>'
    : '';
  // v2.45.72: кнопка «Удалить модель» (soft-delete) — директор/зам
  const deleteBtn = canManageSales()
    ? '<button class="btn btn-danger btn-small" onclick="confirmDeleteModel(' + modelId + ')" title="Деактивировать модель (старые сборки сохраняются)">' +
        '<i class="ti ti-trash"></i> Удалить модель' +
      '</button>'
    : '';

  overlay.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:760px;max-height:90vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header" style="align-items:flex-start;">' +
        '<div style="flex:1;min-width:0;">' +
          '<h3 style="margin:0;">' + _highlightAisi(m.name + (m.extra ? ' · ' + m.extra : '')) + '</h3>' +
          '<div style="font-size:12px;color:var(--text-light);margin-top:4px;">' +
            escapeHtml(dirName) + ' · ' + _highlightAisi(subParts.join(' · ')) +
          '</div>' +
          (editBtn ? '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">' + editBtn + splitBtn + deleteBtn + '</div>' : '') +
        '</div>' +
        '<button class="modal-close" onclick="closeModelDetail()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="overflow-y:auto;flex:1;padding:18px;">' +
        sourceBadge +
        imgHtml +
        pricesHtml +
        descHtml +
        specsHtml +
        charsHtml +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-top:1px solid var(--border);padding-top:14px;">' +
          '<h4 style="margin:0;font-size:15px;"><i class="ti ti-list-details"></i> Тех. карта (BOM)</h4>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            (canManageSales() ?
              '<button class="btn btn-secondary btn-small" onclick="openBomCopyFrom(' + modelId + ', ' + JSON.stringify(m.name || '').replace(/"/g, '&quot;') + ')" title="Скопировать тех.карту из другой модели">' +
                '<i class="ti ti-copy"></i> Взять BOM' +
              '</button>' : '') +
            (canManageSales() ?
              '<button class="btn btn-secondary btn-small" onclick="openBomImportFromText(' + modelId + ', ' + JSON.stringify(m.name || '').replace(/"/g, '&quot;') + ')" title="Вставить BOM из Excel/текста">' +
                '<i class="ti ti-clipboard-data"></i> Импорт BOM' +
              '</button>' : '') +
            (canManageSales() ?
              '<button class="btn btn-primary btn-small" onclick="openBomAddItem(' + modelId + ')">' +
                '<i class="ti ti-plus"></i> Позиция' +
              '</button>' : '') +
          '</div>' +
        '</div>' +
        '<div id="bom-list"><div class="loading-block">Загружаем…</div></div>' +
        // v2.43.25: блок «История сборок» — кто и когда собирал, по каким договорам
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:22px 0 10px;border-top:1px solid var(--border);padding-top:14px;">' +
          '<h4 style="margin:0;font-size:15px;"><i class="ti ti-history"></i> Сборки этой модели</h4>' +
        '</div>' +
        '<div id="model-assemblies-list"><div class="loading-block">Загружаем историю…</div></div>' +
      '</div>' +
    '</div>';
  overlay.classList.add('visible');
  await loadModelBom(modelId);
  loadModelAssembliesBlock(modelId);
  // v2.43.85: фото грузим лениво через blob — эндпоинт требует Bearer-токен
  if (m.photo_key) _loadModelPhotoFromBackend(modelId);
}

// v2.45.72: soft-delete модели (директор/зам). Сборки сохраняются.
async function confirmDeleteModel(modelId) {
  if (!confirm('Удалить эту модель из каталога?\n\n' +
    'Модель станет неактивной. Старые сборки и история останутся, но больше нельзя будет создать новую работу по этой модели.\n\n' +
    'Если позже передумаешь — модель можно восстановить через PATCH (is_active=true).')) return;
  try {
    await apiDelete('/api/models/' + modelId);
    showToast('Модель удалена', 'success');
    cache.models = null;
    closeModelDetail();
    if (typeof loadModels === 'function') {
      try { await loadModels(); } catch (e) {}
    }
  } catch (e) {
    showToast((e && e.message) || 'Не удалось удалить', 'error');
  }
}

// v2.43.25: загрузка истории сборок модели для модалки
// v2.43.55: удаление сборки (soft-delete) с диалогом подтверждения
async function confirmDeleteAssembly(assemblyId, modelId) {
  const reason = prompt('Удалить эту сборку?\n\nЕсли сборка готова и есть на складе — будет создано списание (write_off).\n\nУкажите причину (необязательно):', '');
  // null = отмена; пустая строка тоже принимаем (без причины)
  if (reason === null) return;
  try {
    const r = await apiDelete('/api/assemblies/' + assemblyId, { reason: reason || '' });
    if (r && r.write_off_qty > 0) {
      showToast('Сборка удалена · списано со склада: ' + r.write_off_qty, 'success');
    } else {
      showToast('Сборка удалена', 'success');
    }
    // Перезагрузить список сборок модели
    if (modelId) {
      await loadModelAssembliesBlock(modelId);
    }
    // Сбросить кэши чтобы Главная и Канбан подтянули свежее
    cache.productionKanban = null;
    if (cache.models) cache.models = null;
    if (cache.dashboard) cache.dashboard = null;
  } catch (e) {
    showToast((e && e.message) || 'Не удалось удалить', 'error');
  }
}

async function loadModelAssembliesBlock(modelId) {
  const container = document.getElementById('model-assemblies-list');
  if (!container) return;
  try {
    const d = await apiGet('/api/models/' + modelId + '/assemblies?limit=30');
    const list = d.items || [];
    if (!list.length) {
      container.innerHTML = '<div style="background:var(--bg);border-radius:8px;padding:14px;font-size:13px;color:var(--text-light);text-align:center;">Сборок этой модели пока не было.</div>';
      return;
    }
    // Контекст: подсвечиваем сборки текущего договора (если карточка открыта из договора)
    const ctxContractId = (state && state.currentContractId) || null;
    const statusBadgeMap = {
      'in_progress': { cls: 'a-st-inprog',  icon: 'ti-tool',         label: 'В работе' },
      'ready':       { cls: 'a-st-ready',   icon: 'ti-circle-check', label: 'Готово' },
      'shipped':     { cls: 'a-st-shipped', icon: 'ti-truck-delivery', label: 'Отгружено' },
      'written_off': { cls: 'a-st-shipped', icon: 'ti-trash',        label: 'Списано' },
    };
    let html = '<div style="display:flex;flex-direction:column;gap:8px;">';
    const canDelete = hasPermission('production.manage');  // мастер или директор
    list.forEach(a => {
      const isCurrent = ctxContractId && a.contract_id === ctxContractId;
      const sb = statusBadgeMap[a.status] || statusBadgeMap['in_progress'];
      const workers = (a.workers || []).map(w => escapeHtml(w.short_name || w.full_name || '')).filter(Boolean);
      const workersStr = workers.length ? workers.join(', ') : '<span style="color:var(--text-light);">—</span>';
      const dateStr = a.assembly_date ? formatDateShort(a.assembly_date) : '—';
      const contractStr = a.contract_number
        ? (escapeHtml(String(a.contract_number).replace(/^[№#\s]+/, '')) + (a.contractor_name ? ' · ' + escapeHtml(a.contractor_name) : ''))
        : '<span style="color:var(--text-light);">без договора</span>';
      // v2.43.55: кнопка удаления (для всех кроме отгруженной)
      const showDelete = canDelete && a.status !== 'shipped';
      const deleteBtn = showDelete
        ? '<button class="mam-del-btn" onclick="confirmDeleteAssembly(' + a.id + ',' + (a.model_id || 'null') + ')" title="Удалить сборку"><i class="ti ti-trash"></i></button>'
        : '';
      html += '<div class="mam-row" style="' +
        'background:' + (isCurrent ? 'var(--brand-bg)' : 'var(--bg)') + ';' +
        'border:1px solid ' + (isCurrent ? 'var(--brand)' : 'var(--border)') + ';' +
        'border-radius:8px; padding:10px 12px;' +
        'display:grid; grid-template-columns: 70px 1fr auto auto; gap:10px; align-items:center; font-size:13px;">' +
        '<div style="font-weight:600; color:var(--text-dark);">' + dateStr + '</div>' +
        '<div>' +
          '<div style="font-size:12px; color:var(--text-light); margin-bottom:2px;">Договор</div>' +
          '<div style="font-weight:500;">' + contractStr + '</div>' +
          '<div style="font-size:12px; color:var(--text-light); margin-top:4px;">Сборщики: ' + workersStr + '</div>' +
        '</div>' +
        '<div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">' +
          '<span class="a-status-badge ' + sb.cls + '"><i class="ti ' + sb.icon + '"></i>' + sb.label + '</span>' +
          '<div style="font-size:12px; color:var(--text-light);">' + a.quantity + ' шт.</div>' +
        '</div>' +
        deleteBtn +
      '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div style="background:var(--bg);border-radius:8px;padding:12px;font-size:13px;color:var(--danger);">Не удалось загрузить историю: ' + escapeHtml(String(e.message || e)) + '</div>';
  }
}

function closeModelDetail() {
  const o = document.getElementById('model-detail-modal');
  if (o) o.classList.remove('visible');
  state._currentBomModelId = null;
}

// ============================================================
// v2.43.85: Характеристики модели + фото + AI-разбор спецификации
// ============================================================

const CHILLER_CHARS_TEMPLATE = {
  sections: [
    { title: 'Параметры холодильного агрегата', items: [
      {key:'Производитель',value:''},{key:'Наименование',value:''},
      {key:'Холодопроизводительность, кВт',value:''},{key:'Хладагент',value:''},
      {key:'Хладоноситель',value:''},{key:'Тип расширительного устройства',value:''},
      {key:'Температура х/носителя на вход/выход',value:''},
      {key:'Электропитание',value:''},{key:'Потребляемая мощность, кВт',value:''},
    ]},
    { title: 'Компрессор', items: [
      {key:'Тип компрессора',value:''},{key:'Количество, шт',value:''},
      {key:'Холодопроизводительность, кВт',value:''},
      {key:'Температура кипения, °C',value:''},{key:'Температура конденсации, °C',value:''},
    ]},
    { title: 'Испаритель', items: [
      {key:'Тип испарителя',value:''},
    ]},
    { title: 'Охлаждение', items: [
      {key:'Конструктивное исполнение конденсатора',value:''},
      {key:'Расход воздуха, м³/ч',value:''},{key:'Вентилятор, мм x кол-во',value:''},
      {key:'Уровень шума, дБА x кол-во',value:''},
      {key:'Габаритные размеры (Ш*Г*В), мм',value:''},{key:'Вес, кг',value:''},
    ]},
    { title: 'Присоединительные патрубки фреонового контура', items: [
      {key:'Диаметр патрубка вход, дюйм (мм)',value:''},
      {key:'Диаметр патрубка выход, дюйм (мм)',value:''},
    ]},
    { title: 'Гидромодуль', items: [
      {key:'Объём аккумулирующего бака, л',value:''},{key:'Тип насоса',value:''},
      {key:'Номинальная производительность, м³/ч',value:''},
      {key:'Номинальный напор, м',value:''},
    ]},
    { title: 'Общие размеры агрегата', items: [
      {key:'(Д*Ш*В), мм',value:''},{key:'Вес, кг',value:''},
    ]},
  ]
};

function _parseModelChars(m) {
  if (!m || !m.characteristics) return { sections: [] };
  try {
    const o = JSON.parse(m.characteristics);
    if (o && Array.isArray(o.sections)) return o;
  } catch (e) {}
  return { sections: [] };
}

function _renderModelCharsBlock(m) {
  const chars = _parseModelChars(m);
  const canEdit = (typeof canManageSales === 'function') && canManageSales();
  const hasChars = chars.sections.length > 0;
  const hasPhoto = !!m.photo_key;
  const hasSpec = !!m.spec_file_key;

  let html = '<div style="border-top:1px solid var(--border);padding-top:14px;margin-bottom:18px;">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">';
  html += '<h4 style="margin:0;font-size:15px;"><i class="ti ti-list-check"></i> Характеристики</h4>';
  if (canEdit) {
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
    html += '<button class="btn btn-secondary btn-small" onclick="openCharsEditor(' + m.id + ')"><i class="ti ti-edit"></i> Редактировать</button>';
    html += '<label class="btn btn-secondary btn-small" style="cursor:pointer;margin:0;">' +
              '<i class="ti ti-photo-plus"></i> Фото' +
              '<input type="file" accept="image/*" style="display:none;" onchange="uploadModelPhoto(' + m.id + ', this)">' +
            '</label>';
    html += '<label class="btn btn-secondary btn-small" style="cursor:pointer;margin:0;">' +
              '<i class="ti ti-file-upload"></i> Файл СП' +
              '<input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" style="display:none;" onchange="uploadModelSpec(' + m.id + ', this)">' +
            '</label>';
    // v2.45.228: принципиальная схема (PDF)
    html += '<label class="btn btn-secondary btn-small" style="cursor:pointer;margin:0;">' +
              '<i class="ti ti-schema"></i> Схема (PDF)' +
              '<input type="file" accept=".pdf,image/*" style="display:none;" onchange="uploadModelScheme(' + m.id + ', this)">' +
            '</label>';
    if (hasSpec) {
      html += '<button class="btn btn-primary btn-small" onclick="parseModelSpec(' + m.id + ')" title="Разобрать загруженный файл через AI"><i class="ti ti-sparkles"></i> Разобрать AI</button>';
    }
    html += '</div>';
  }
  html += '</div>';

  // Фото (если есть). v2.45.225: крестик удаления в углу
  if (hasPhoto) {
    html += '<div id="model-photo-wrap-' + m.id + '" style="margin-bottom:14px;text-align:center;position:relative;display:block;">' +
              '<img id="model-photo-img-' + m.id + '" alt="Фото модели" style="max-width:100%;max-height:280px;border-radius:8px;border:1px solid var(--border);" />' +
              (canEdit ?
                '<button onclick="deleteModelPhoto(' + m.id + ')" title="Удалить фото" ' +
                  'style="position:absolute;top:8px;right:8px;width:30px;height:30px;border-radius:50%;border:1px solid var(--border);background:rgba(255,255,255,0.95);color:var(--danger);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.15);">' +
                  '<i class="ti ti-trash"></i></button>' : '') +
            '</div>';
  }

  // v2.45.228: принципиальная схема (если есть)
  if (m.scheme_file_key) {
    const sname = escapeHtml(m.scheme_file_name || 'схема.pdf');
    html += '<div style="background:var(--bg);border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px;font-size:13px;flex-wrap:wrap;">' +
              '<i class="ti ti-schema" style="font-size:18px;color:#7C3AED;"></i>' +
              '<span style="flex:1;color:var(--text-dark);min-width:120px;">Принципиальная схема: ' + sname + '</span>' +
              '<button class="btn btn-secondary btn-small" onclick="downloadModelScheme(' + m.id + ')"><i class="ti ti-download"></i> Открыть</button>' +
              (canEdit ? '<button class="btn btn-secondary btn-small" style="color:var(--danger);" onclick="deleteModelSchemeFile(' + m.id + ')" title="Удалить схему"><i class="ti ti-trash"></i></button>' : '') +
            '</div>';
  }

  // Файл СП (если есть). v2.45.225: кнопка удаления
  if (hasSpec) {
    const fname = escapeHtml(m.spec_file_name || 'файл');
    html += '<div style="background:var(--bg);border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px;font-size:13px;flex-wrap:wrap;">' +
              '<i class="ti ti-file-text" style="font-size:18px;color:var(--brand);"></i>' +
              '<span style="flex:1;color:var(--text-dark);min-width:120px;">' + fname + '</span>' +
              '<button class="btn btn-secondary btn-small" onclick="downloadModelSpec(' + m.id + ')"><i class="ti ti-download"></i> Скачать</button>' +
              (canEdit ? '<button class="btn btn-secondary btn-small" style="color:var(--danger);" onclick="deleteModelSpecFile(' + m.id + ')" title="Удалить файл СП"><i class="ti ti-trash"></i></button>' : '') +
            '</div>';
  }

  // Сами характеристики
  if (hasChars) {
    chars.sections.forEach(sec => {
      if (!sec.title && (!sec.items || sec.items.length === 0)) return;
      html += '<div style="background:var(--bg);border-radius:8px;padding:10px 14px;margin-bottom:10px;">';
      if (sec.title) {
        html += '<div style="font-weight:600;font-size:13px;color:var(--text-dark);margin-bottom:6px;">' + escapeHtml(sec.title) + '</div>';
      }
      (sec.items || []).forEach(it => {
        html += '<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px dashed var(--border);font-size:12.5px;">' +
                  '<span style="color:var(--text-light);">' + escapeHtml(it.key || '') + '</span>' +
                  '<span style="color:var(--text-dark);font-weight:500;text-align:right;">' + escapeHtml(it.value || '') + '</span>' +
                '</div>';
      });
      html += '</div>';
    });
  } else if (!hasPhoto && !hasSpec) {
    html += '<div style="font-size:12px;color:var(--text-light);padding:8px 0;">Характеристики не заполнены.' +
            (canEdit ? ' Нажми «Редактировать» или «Файл СП → Разобрать AI».' : '') + '</div>';
  }
  html += '</div>';
  return html;
}

// Лениво подгружаем картинку как blob (фото-эндпоинт требует Bearer-токен).
async function _loadModelPhotoFromBackend(modelId) {
  const img = document.getElementById('model-photo-img-' + modelId);
  if (!img) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/models/' + modelId + '/photo', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) return;
    const blob = await r.blob();
    img.src = URL.createObjectURL(blob);
  } catch (e) {}
}

// v2.45.225: удаление фото / файла СП модели
async function deleteModelPhoto(modelId) {
  if (!confirm('Удалить фото модели?')) return;
  try {
    await apiDelete('/api/models/' + modelId + '/photo');
    showToast('Фото удалено', 'success');
    openModelDetail(modelId);
  } catch (e) { showToast((e && e.message) || 'Не удалось удалить', 'error'); }
}

async function deleteModelSpecFile(modelId) {
  if (!confirm('Удалить файл СП? (разобранные характеристики останутся)')) return;
  try {
    await apiDelete('/api/models/' + modelId + '/spec-file');
    showToast('Файл СП удалён', 'success');
    openModelDetail(modelId);
  } catch (e) { showToast((e && e.message) || 'Не удалось удалить', 'error'); }
}

async function uploadModelPhoto(modelId, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showToast('Фото больше 10 МБ', 'error'); return; }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/models/' + modelId + '/photo', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: fd,
    });
    if (!r.ok) { showToast('Не удалось загрузить фото', 'error'); return; }
    showToast('Фото загружено', 'success');
    cache.models = null;
    openModelDetail(modelId);
  } catch (e) { showToast('Ошибка: ' + (e && e.message || e), 'error'); }
  input.value = '';
}

async function uploadModelSpec(modelId, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) { showToast('Файл больше 25 МБ', 'error'); return; }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/models/' + modelId + '/spec-file', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: fd,
    });
    if (!r.ok) { showToast('Не удалось загрузить файл', 'error'); return; }
    showToast('Файл загружен', 'success');
    cache.models = null;
    openModelDetail(modelId);
  } catch (e) { showToast('Ошибка: ' + (e && e.message || e), 'error'); }
  input.value = '';
}

async function downloadModelSpec(modelId) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/models/' + modelId + '/spec-file', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) { showToast('Не удалось скачать', 'error'); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spec';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  } catch (e) { showToast('Ошибка: ' + (e && e.message || e), 'error'); }
}

// v2.45.228: принципиальная схема (PDF) у модели
async function uploadModelScheme(modelId, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) { showToast('Файл больше 25 МБ', 'error'); return; }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/models/' + modelId + '/scheme-file', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd,
    });
    if (!r.ok) { showToast('Не удалось загрузить схему', 'error'); return; }
    showToast('Схема сохранена', 'success');
    cache.models = null;
    openModelDetail(modelId);
  } catch (e) { showToast('Ошибка: ' + (e && e.message || e), 'error'); }
  input.value = '';
}

async function downloadModelScheme(modelId) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/models/' + modelId + '/scheme-file', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) { showToast('Не удалось открыть', 'error'); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { showToast('Ошибка: ' + (e && e.message || e), 'error'); }
}

async function deleteModelSchemeFile(modelId) {
  if (!confirm('Удалить принципиальную схему?')) return;
  try {
    await apiDelete('/api/models/' + modelId + '/scheme-file');
    showToast('Схема удалена', 'success');
    cache.models = null;
    openModelDetail(modelId);
  } catch (e) { showToast((e && e.message) || 'Не удалось удалить', 'error'); }
}

// v2.45.228: убрать картинку (image_path) — у этой модели или у всех с такой же
async function deleteModelImage(modelId) {
  const all = confirm('Убрать эту картинку у ВСЕХ моделей, где она используется?\n\nОК — у всех (например, у всех копий ATOM HNR)\nОтмена — только у этой модели');
  if (!all && !confirm('Убрать картинку только у этой модели?')) return;
  try {
    const r = await apiDelete('/api/models/' + modelId + '/image' + (all ? '?all_same=1' : ''));
    showToast('Картинка убрана' + (r && r.cleared > 1 ? ' у ' + r.cleared + ' моделей' : ''), 'success');
    cache.models = null;
    openModelDetail(modelId);
  } catch (e) { showToast((e && e.message) || 'Не удалось убрать', 'error'); }
}

async function parseModelSpec(modelId) {
  showToast('Просим AI разобрать файл (15-40 сек)…', 'info');
  try {
    const r = await apiPost('/api/models/' + modelId + '/parse-spec', {});
    if (!r.ok || !r.data || !r.data.sections) {
      showToast((r.data && r.data.message) || 'AI не смог разобрать', 'error');
      return;
    }
    // Открываем редактор с распарсенными секциями для подтверждения
    openCharsEditor(modelId, { sections: r.data.sections });
    showToast('AI вернул ' + r.data.sections.length + ' секций — проверь и сохрани', 'success');
  } catch (e) { showToast('Ошибка: ' + (e && e.message || e), 'error'); }
}

// Редактор характеристик (модал поверх детали модели)
function openCharsEditor(modelId, initial) {
  // Если initial не передан — берём из кэша модели
  let chars = initial;
  if (!chars) {
    const m = ((cache.models && cache.models.models) || []).find(x => x.id === modelId);
    chars = _parseModelChars(m);
  }
  state._charsEditing = JSON.parse(JSON.stringify(chars || {sections:[]}));
  if (!state._charsEditing.sections) state._charsEditing.sections = [];

  let overlay = document.getElementById('chars-editor-modal');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'chars-editor-modal';
  overlay.className = 'modal-overlay visible';
  overlay.style.zIndex = '260';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
  _renderCharsEditor(modelId);
}

function _renderCharsEditor(modelId) {
  const overlay = document.getElementById('chars-editor-modal');
  if (!overlay) return;
  const ce = state._charsEditing || {sections:[]};
  let html =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:680px;max-height:92vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-list-check"></i> Характеристики</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'chars-editor-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:12px 18px 0;display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:12px;">' +
        '<button class="btn btn-secondary btn-small" onclick="_charsApplyChillerTemplate()" title="Заменить структурой из ТЗ чиллера"><i class="ti ti-template"></i> Шаблон «Чиллер»</button>' +
        '<button class="btn btn-secondary btn-small" onclick="_charsAddSection()"><i class="ti ti-plus"></i> Добавить раздел</button>' +
      '</div>' +
      '<div id="chars-editor-body" style="flex:1;overflow-y:auto;padding:14px 18px;">';
  ce.sections.forEach((sec, sIdx) => {
    html += '<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:10px;background:white;">' +
              '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">' +
                '<input type="text" class="form-input" placeholder="Название раздела" value="' + escapeHtml(sec.title || '') + '" oninput="_charsSetSectionTitle(' + sIdx + ', this.value)" style="flex:1;margin:0;font-weight:600;" />' +
                '<button class="btn btn-secondary btn-small" onclick="_charsRemoveSection(' + sIdx + ')" style="color:var(--danger);" title="Удалить раздел"><i class="ti ti-trash"></i></button>' +
              '</div>';
    (sec.items || []).forEach((it, iIdx) => {
      html += '<div style="display:flex;gap:6px;margin-bottom:5px;">' +
                '<input type="text" class="form-input" placeholder="Параметр" value="' + escapeHtml(it.key || '') + '" oninput="_charsSetItemKey(' + sIdx + ',' + iIdx + ', this.value)" style="flex:1;margin:0;font-size:12.5px;" />' +
                '<input type="text" class="form-input" placeholder="Значение" value="' + escapeHtml(it.value || '') + '" oninput="_charsSetItemValue(' + sIdx + ',' + iIdx + ', this.value)" style="flex:1;margin:0;font-size:12.5px;" />' +
                '<button class="btn btn-secondary btn-small" onclick="_charsRemoveItem(' + sIdx + ',' + iIdx + ')" style="color:var(--danger);" title="Удалить"><i class="ti ti-x"></i></button>' +
              '</div>';
    });
    html += '<button class="btn btn-secondary btn-small" onclick="_charsAddItem(' + sIdx + ')" style="margin-top:4px;"><i class="ti ti-plus"></i> Параметр</button>';
    html += '</div>';
  });
  if (ce.sections.length === 0) {
    html += '<div class="empty-block" style="padding:16px;"><i class="ti ti-info-circle"></i>Нажми «Шаблон Чиллер» или «Добавить раздел»</div>';
  }
  html += '</div>' +
    '<div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">' +
      '<button class="btn btn-secondary" onclick="document.getElementById(\'chars-editor-modal\').remove()">Отмена</button>' +
      '<button class="btn btn-primary" onclick="saveChars(' + modelId + ')"><i class="ti ti-check"></i> Сохранить</button>' +
    '</div></div>';
  overlay.innerHTML = html;
}

function _charsApplyChillerTemplate() {
  state._charsEditing = JSON.parse(JSON.stringify(CHILLER_CHARS_TEMPLATE));
  _renderCharsEditor(state._currentBomModelId);
}
function _charsAddSection() {
  state._charsEditing.sections.push({title: '', items: []});
  _renderCharsEditor(state._currentBomModelId);
}
function _charsRemoveSection(i) {
  state._charsEditing.sections.splice(i, 1);
  _renderCharsEditor(state._currentBomModelId);
}
function _charsSetSectionTitle(i, v) { state._charsEditing.sections[i].title = v; }
function _charsAddItem(i) {
  state._charsEditing.sections[i].items = state._charsEditing.sections[i].items || [];
  state._charsEditing.sections[i].items.push({key: '', value: ''});
  _renderCharsEditor(state._currentBomModelId);
}
function _charsRemoveItem(i, j) {
  state._charsEditing.sections[i].items.splice(j, 1);
  _renderCharsEditor(state._currentBomModelId);
}
function _charsSetItemKey(i, j, v)   { state._charsEditing.sections[i].items[j].key = v; }
function _charsSetItemValue(i, j, v) { state._charsEditing.sections[i].items[j].value = v; }

async function saveChars(modelId) {
  const payload = { sections: state._charsEditing.sections };
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/models/' + modelId + '/characteristics', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
    });
    if (!r.ok) { showToast('Не удалось сохранить', 'error'); return; }
    showToast('Сохранено', 'success');
    document.getElementById('chars-editor-modal').remove();
    cache.models = null;
    openModelDetail(modelId);
  } catch (e) { showToast('Ошибка: ' + (e && e.message || e), 'error'); }
}

// ============ ЭТАП 45 (v2.33.0): РЕДАКТИРОВАНИЕ МОДЕЛИ ============

async function openEditModelModal(modelId) {
  if (!canManageSales()) {
    showToast('Редактирование доступно директору и заму', 'error');
    return;
  }
  let m = ((cache.models && cache.models.models) || []).find(x => x.id === modelId);
  if (!m) {
    try {
      const d = await apiGet('/api/models?with_stock=false');
      cache.models = d;
      m = (d.models || []).find(x => x.id === modelId);
    } catch (e) {}
  }
  if (!m) { showToast('Модель не найдена', 'error'); return; }

  // Подгружаем specs
  let specsObj = {};
  if (m.specs && typeof m.specs === 'object') specsObj = m.specs;
  else if (m.specs_json) {
    try { specsObj = JSON.parse(m.specs_json) || {}; } catch (e) { specsObj = {}; }
  }
  state._editModelSpecs = Object.keys(specsObj).map(k => ({ key: k, val: String(specsObj[k]) }));
  state._editModelId = modelId;

  let overlay = document.getElementById('edit-model-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'edit-model-modal';
    overlay.className = 'modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('visible'); };
    document.body.appendChild(overlay);
  }

  // Закрываем detail-модалку чтобы не перекрывала
  const detailM = document.getElementById('model-detail-modal');
  if (detailM) detailM.classList.remove('visible');

  overlay.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:640px;max-height:92vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-edit"></i> Редактирование модели</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'edit-model-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body" style="overflow-y:auto;">' +
        '<div class="form-hint" style="margin-bottom:14px;">' +
          '<i class="ti ti-info-circle" style="vertical-align:-2px;margin-right:4px;color:var(--brand);"></i>' +
          'Раздел, подгруппу и категорию можно менять — модель переедет.' +
        '</div>' +
        // v2.45.237: артикул редактируемый (с проверкой уникальности на сервере)
        '<div class="form-group">' +
          '<label>Артикул * <span style="text-transform:none;color:var(--text-faint);font-weight:400;">(уникальный; история сборок сохранится)</span></label>' +
          '<input type="text" id="em-article" value="' + escapeHtml(m.article || '') + '" style="font-family:monospace;text-transform:uppercase;" />' +
        '</div>' +
        '<div class="modal-section-title">Раздел</div>' +
        '<div class="form-group">' +
          '<label>Направление *</label>' +
          '<select id="em-direction" onchange="_onEmDirChange()">' + (function(){
            const ds = (cache.models && cache.models.directions) || [];
            return ds.map(d =>
              '<option value="' + d.id + '"' + (d.id === m.direction_id ? ' selected' : '') + '>' + escapeHtml(d.name) + '</option>'
            ).join('');
          })() + '</select>' +
        '</div>' +
        '<div class="form-group" id="em-subgroup-wrap" style="display:none;">' +
          '<label>Подгруппа <span style="text-transform:none;color:var(--text-faint);font-weight:400;">(опционально)</span></label>' +
          '<select id="em-subgroup" onchange="_onEmSubgroupChange()"><option value="">— Без подгруппы —</option></select>' +
        '</div>' +
        // v2.45.196: категория (подраздел внутри подгруппы) — чтобы перенести
        // модель в нужную группу (напр. «ЩУ-004.000 Приточно-вытяжная вентиляция»).
        '<div class="form-group" id="em-category-wrap" style="display:none;">' +
          '<label>Категория <span style="text-transform:none;color:var(--text-faint);font-weight:400;">(подраздел, опционально)</span></label>' +
          '<select id="em-category"><option value="">— Без категории —</option></select>' +
        '</div>' +
        '<div class="modal-section-title">Основное</div>' +
        '<div class="form-group">' +
          '<label>Название *</label>' +
          '<input type="text" id="em-name" value="' + escapeHtml(m.name || '') + '" />' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Дополнительно <span style="text-transform:none;color:var(--text-faint);font-weight:400;">(размеры, IP, исполнение и т.д.)</span></label>' +
          '<input type="text" id="em-extra" value="' + escapeHtml(m.extra || '') + '" />' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Описание</label>' +
          '<textarea id="em-description" rows="3" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;resize:vertical;">' + escapeHtml(m.description || '') + '</textarea>' +
        '</div>' +
        '<div class="modal-section-title">Цены</div>' +
        '<div class="form-row">' +
          '<div class="form-group">' +
            '<label>Розничная, ₽</label>' +
            '<input type="number" id="em-base-price" step="0.01" min="0" value="' + (m.base_price != null ? m.base_price : '') + '" />' +
          '</div>' +
          '<div class="form-group">' +
            '<label>Дилерская, ₽</label>' +
            '<input type="number" id="em-dealer-price" step="0.01" min="0" value="' + (m.dealer_price != null ? m.dealer_price : '') + '" />' +
          '</div>' +
        '</div>' +
        '<div class="form-group">' +
          '<label>НС-код <span style="text-transform:none;color:var(--text-faint);font-weight:400;">(опционально)</span></label>' +
          '<input type="text" id="em-nc-code" value="' + escapeHtml(m.nc_code || '') + '" style="font-family:monospace;" />' +
        '</div>' +
        '<div class="modal-section-title">Характеристики</div>' +
        '<div id="em-specs-editor"></div>' +
        '<button class="btn btn-secondary" onclick="addEmSpecRow()" style="border-style:dashed;margin-top:8px;width:100%;">' +
          '<i class="ti ti-plus"></i> Добавить характеристику' +
        '</button>' +
        '<div class="modal-section-title" style="margin-top:18px;">Сборка</div>' +
        '<div class="form-group">' +
          '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;font-size:14px;font-weight:400;color:var(--text-dark);">' +
            '<input type="checkbox" id="em-needs-ip"' + (m.needs_ip ? ' checked' : '') + ' style="width:auto;flex-shrink:0;" />' +
            '<span>Требуется указать IP при сборке</span>' +
          '</label>' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Исполнение</label>' +
          '<select id="em-exec-mode" onchange="_onEmExecModeChange()">' +
            '<option value="none"' + (m.exec_mode === 'none' ? ' selected' : '') + '>Без выбора</option>' +
            '<option value="choice"' + (m.exec_mode === 'choice' ? ' selected' : '') + '>Мастер выбирает: Стандарт / Нерж.</option>' +
            '<option value="fixed"' + (m.exec_mode === 'fixed' ? ' selected' : '') + '>Фиксированное</option>' +
          '</select>' +
        '</div>' +
        '<div class="form-group" id="em-exec-fixed-wrap" style="' + (m.exec_mode === 'fixed' ? '' : 'display:none;') + '">' +
          '<label>Какое исполнение</label>' +
          '<input type="text" id="em-exec-fixed" value="' + escapeHtml(m.exec_fixed || '') + '" placeholder="Например: Нерж. AISI 304" />' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Тип работы</label>' +
          '<select id="em-work-type">' +
            '<option value="full_build"' + ((m.work_type || 'full_build') === 'full_build' ? ' selected' : '') + '>Полная сборка из материалов</option>' +
            '<option value="modify_purchased"' + (m.work_type === 'modify_purchased' ? ' selected' : '') + '>Модификация покупного товара</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'edit-model-modal\').classList.remove(\'visible\'); openModelDetail(' + modelId + ')">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitEditModel(' + modelId + ')"><i class="ti ti-check"></i> Сохранить</button>' +
      '</div>' +
    '</div>';
  overlay.classList.add('visible');
  renderEmSpecsEditor();
  // ЭТАП 45.1: инициализация подгрупп для текущего направления + выбор текущей
  _onEmDirChange();
  setTimeout(() => {
    const sgSel = document.getElementById('em-subgroup');
    if (sgSel && m.subgroup_id) sgSel.value = String(m.subgroup_id);
    // v2.45.196: подтянуть категории под подгруппу и выставить текущую категорию
    _onEmSubgroupChange();
    const catSel = document.getElementById('em-category');
    if (catSel && m.category_id) catSel.value = String(m.category_id);
  }, 50);
}

function _onEmDirChange() {
  const dirSel = document.getElementById('em-direction');
  const sgWrap = document.getElementById('em-subgroup-wrap');
  const sgSel = document.getElementById('em-subgroup');
  if (!dirSel || !sgWrap || !sgSel) return;
  const dirId = parseInt(dirSel.value);
  const directions = (cache.models && cache.models.directions) || [];
  const dir = directions.find(d => d.id === dirId);
  const subgroups = (dir && dir.subgroups) || [];
  if (!subgroups.length) {
    sgWrap.style.display = 'none';
    sgSel.innerHTML = '<option value="">— Без подгруппы —</option>';
  } else {
    sgWrap.style.display = '';
    let opts = '<option value="">— Без подгруппы —</option>';
    subgroups.forEach(sg => {
      opts += '<option value="' + sg.id + '">' + escapeHtml(sg.name) + '</option>';
    });
    sgSel.innerHTML = opts;
  }
  // v2.45.196: обновляем категории под выбранную подгруппу
  _onEmSubgroupChange();
}

// v2.45.196: список категорий (подразделов) под выбранную подгруппу — для
// переноса модели в нужную группу из формы редактирования. Зеркало
// onNewModelSubgroupChange, но для полей em-*.
function _onEmSubgroupChange() {
  const dirSel = document.getElementById('em-direction');
  const sgSel = document.getElementById('em-subgroup');
  const catWrap = document.getElementById('em-category-wrap');
  const catSel = document.getElementById('em-category');
  if (!dirSel || !catWrap || !catSel) return;
  const dirId = parseInt(dirSel.value);
  const sgId = sgSel && sgSel.value ? parseInt(sgSel.value) : null;
  const allCats = (cache.models && cache.models.categories) || [];
  const dirCats = allCats.filter(c => c.direction_id === dirId);
  // v2.45.197: привязанные к подгруппе + непривязанные (легаси) категории
  const cats = sgId
    ? dirCats.filter(c => c.parent_subgroup_id === sgId || !c.parent_subgroup_id)
    : dirCats.filter(c => !c.parent_subgroup_id);
  if (!dirCats.length) {
    catWrap.style.display = 'none';
    catSel.innerHTML = '<option value="">— Без категории —</option>';
    return;
  }
  catWrap.style.display = '';
  let opts = '<option value="">— Без категории —</option>';
  cats.forEach(c => { opts += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>'; });
  catSel.innerHTML = opts;
}

function _onEmExecModeChange() {
  const sel = document.getElementById('em-exec-mode');
  const wrap = document.getElementById('em-exec-fixed-wrap');
  if (!sel || !wrap) return;
  wrap.style.display = sel.value === 'fixed' ? '' : 'none';
}

function renderEmSpecsEditor() {
  const container = document.getElementById('em-specs-editor');
  if (!container) return;
  const rows = state._editModelSpecs || [];
  if (!rows.length) {
    container.innerHTML = '<div style="color:var(--text-faint);font-size:13px;padding:8px 0;font-style:italic;">Пока нет характеристик. Жми «+ Добавить» чтобы внести.</div>';
    return;
  }
  let html = '';
  rows.forEach((r, idx) => {
    html += '<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">' +
      '<input type="text" placeholder="Параметр (напр. Мощность)" value="' + escapeHtml(r.key) + '" oninput="updateEmSpec(' + idx + ',\'key\',this.value)" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;" />' +
      '<input type="text" placeholder="Значение (14 кВт)" value="' + escapeHtml(r.val) + '" oninput="updateEmSpec(' + idx + ',\'val\',this.value)" style="flex:1.2;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;" />' +
      '<button class="icon-btn" onclick="removeEmSpec(' + idx + ')" title="Удалить" style="color:var(--danger);"><i class="ti ti-trash"></i></button>' +
    '</div>';
  });
  container.innerHTML = html;
}

function addEmSpecRow() {
  if (!state._editModelSpecs) state._editModelSpecs = [];
  state._editModelSpecs.push({ key: '', val: '' });
  renderEmSpecsEditor();
}

function updateEmSpec(idx, field, value) {
  if (!state._editModelSpecs || !state._editModelSpecs[idx]) return;
  state._editModelSpecs[idx][field] = value;
}

function removeEmSpec(idx) {
  if (!state._editModelSpecs) return;
  state._editModelSpecs.splice(idx, 1);
  renderEmSpecsEditor();
}

async function submitEditModel(modelId) {
  const name = (document.getElementById('em-name').value || '').trim();
  if (!name) { showToast('Название не может быть пустым', 'error'); return; }
  // v2.45.237: артикул
  const articleEl = document.getElementById('em-article');
  const article = articleEl ? (articleEl.value || '').trim().toUpperCase() : '';
  if (articleEl && !article) { showToast('Артикул не может быть пустым', 'error'); return; }
  const extra = (document.getElementById('em-extra').value || '').trim();
  const description = (document.getElementById('em-description').value || '').trim();
  const basePriceRaw = document.getElementById('em-base-price').value;
  const dealerPriceRaw = document.getElementById('em-dealer-price').value;
  const ncCode = (document.getElementById('em-nc-code').value || '').trim();
  const needsIp = document.getElementById('em-needs-ip').checked;
  const execMode = document.getElementById('em-exec-mode').value;
  const execFixed = (document.getElementById('em-exec-fixed').value || '').trim();
  const workType = document.getElementById('em-work-type').value;
  // ЭТАП 45.1: перенос между разделами
  const directionId = parseInt(document.getElementById('em-direction').value);
  const sgSel = document.getElementById('em-subgroup');
  const subgroupRaw = sgSel ? sgSel.value : '';
  const subgroupId = subgroupRaw ? parseInt(subgroupRaw) : null;
  // v2.45.196: категория (подраздел)
  const catSelEm = document.getElementById('em-category');
  const categoryRaw = catSelEm ? catSelEm.value : '';
  const categoryId = categoryRaw ? parseInt(categoryRaw) : null;

  // Собираем specs из state
  const specs = {};
  (state._editModelSpecs || []).forEach(r => {
    const k = String(r.key || '').trim();
    const v = String(r.val || '').trim();
    if (k && v) specs[k] = v;
  });

  const body = {
    name,
    article: article,
    extra: extra || '',
    description: description || '',
    base_price: basePriceRaw === '' ? null : parseFloat(basePriceRaw),
    dealer_price: dealerPriceRaw === '' ? null : parseFloat(dealerPriceRaw),
    nc_code: ncCode,
    needs_ip: needsIp,
    exec_mode: execMode,
    exec_fixed: execMode === 'fixed' ? execFixed : '',
    work_type: workType,
    specs: specs,
    direction_id: directionId,
    subgroup_id: subgroupId,
    category_id: categoryId,
  };

  try {
    await apiPatch('/api/models/' + modelId, body);
    showToast('Модель обновлена', 'success');
    document.getElementById('edit-model-modal').classList.remove('visible');
    cache.models = null;
    // Заново загружаем для актуального кэша
    try {
      const d = await apiGet('/api/models?with_stock=true');
      cache.models = d;
      if (typeof renderModels === 'function' && document.querySelector('[data-screen="models"].active')) {
        renderModels(d);
      }
    } catch (e) {}
    // Снова открываем деталь
    setTimeout(() => openModelDetail(modelId), 200);
  } catch (e) {
    showToast('Ошибка сохранения: ' + (e.message || e), 'error');
  }
}

// ============ КОНЕЦ ЭТАПА 45 (UI блок 2) ============


// ============ ЭТАП 45.1 (v2.33.1): РЕДАКТИРОВАНИЕ/ДУБЛИРОВАНИЕ РАЗДЕЛОВ ============

async function openEditDirectionModal(directionId) {
  if (!canManageSales()) {
    showToast('Редактирование разделов доступно директору и заму', 'error');
    return;
  }
  const dir = ((cache.models && cache.models.directions) || []).find(d => d.id === directionId);
  if (!dir) { showToast('Раздел не найден', 'error'); return; }

  let overlay = document.getElementById('edit-direction-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'edit-direction-modal';
    overlay.className = 'modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('visible'); };
    document.body.appendChild(overlay);
  }
  overlay.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:440px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-edit"></i> Переименовать раздел</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'edit-direction-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="form-group">' +
          '<label>Название *</label>' +
          '<input type="text" id="ed-dir-name" value="' + escapeHtml(dir.name || '') + '" />' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Подзаголовок <span style="text-transform:none;color:var(--text-faint);font-weight:400;">(опционально)</span></label>' +
          '<input type="text" id="ed-dir-subtitle" value="' + escapeHtml(dir.subtitle || '') + '" />' +
        '</div>' +
        '<div class="form-hint">' +
          '<i class="ti ti-info-circle" style="vertical-align:-2px;margin-right:4px;color:var(--brand);"></i>' +
          'Код раздела (' + escapeHtml(dir.code || '—') + ') менять нельзя — он привязан к артикулам моделей.' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'edit-direction-modal\').classList.remove(\'visible\')">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitEditDirection(' + directionId + ')"><i class="ti ti-check"></i> Сохранить</button>' +
      '</div>' +
    '</div>';
  overlay.classList.add('visible');
  setTimeout(() => {
    const n = document.getElementById('ed-dir-name');
    if (n) { n.focus(); n.select(); }
  }, 50);
}

async function submitEditDirection(directionId) {
  const name = (document.getElementById('ed-dir-name').value || '').trim();
  const subtitle = (document.getElementById('ed-dir-subtitle').value || '').trim();
  if (!name) { showToast('Название не может быть пустым', 'error'); return; }
  try {
    await apiPatch('/api/directions/' + directionId, { name, subtitle });
    showToast('Раздел переименован', 'success');
    document.getElementById('edit-direction-modal').classList.remove('visible');
    cache.models = null;
    if (typeof loadModels === 'function') {
      try { await loadModels(); } catch (e) {}
    }
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

async function openDuplicateDirectionModal(directionId) {
  if (!canManageSales()) {
    showToast('Дублирование разделов доступно директору и заму', 'error');
    return;
  }
  const dir = ((cache.models && cache.models.directions) || []).find(d => d.id === directionId);
  if (!dir) { showToast('Раздел не найден', 'error'); return; }
  // Подсчёт моделей и подгрупп для информации
  const models = ((cache.models && cache.models.models) || []).filter(m => m.direction_id === directionId && m.is_active !== false);
  const subgroupsCount = (dir.subgroups || []).length;

  let overlay = document.getElementById('duplicate-direction-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'duplicate-direction-modal';
    overlay.className = 'modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('visible'); };
    document.body.appendChild(overlay);
  }
  const defaultName = (dir.name || '') + ' (копия)';
  overlay.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:480px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-copy"></i> Дублировать раздел</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'duplicate-direction-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="form-hint" style="margin-bottom:14px;">' +
          '<i class="ti ti-info-circle" style="vertical-align:-2px;margin-right:4px;color:var(--brand);"></i>' +
          'Будет создан новый раздел. Можно скопировать вместе с подгруппами и моделями. Артикулы новых моделей: <b>&lt;старый&gt;-COPY</b>.' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Название нового раздела *</label>' +
          '<input type="text" id="dup-dir-name" value="' + escapeHtml(defaultName) + '" />' +
        '</div>' +
        '<div class="form-group" style="background:var(--bg);border-radius:8px;padding:12px 14px;">' +
          '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;font-size:14px;font-weight:400;color:var(--text-dark);margin-bottom:8px;">' +
            '<input type="checkbox" id="dup-dir-subgroups" checked style="width:auto;flex-shrink:0;" />' +
            '<span>Скопировать подгруппы (' + subgroupsCount + ')</span>' +
          '</label>' +
          '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;font-size:14px;font-weight:400;color:var(--text-dark);">' +
            '<input type="checkbox" id="dup-dir-models" checked style="width:auto;flex-shrink:0;" />' +
            '<span>Скопировать модели (' + models.length + ')</span>' +
          '</label>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'duplicate-direction-modal\').classList.remove(\'visible\')">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitDuplicateDirection(' + directionId + ')"><i class="ti ti-check"></i> Дублировать</button>' +
      '</div>' +
    '</div>';
  overlay.classList.add('visible');
  setTimeout(() => {
    const n = document.getElementById('dup-dir-name');
    if (n) { n.focus(); n.select(); }
  }, 50);
}

async function submitDuplicateDirection(directionId) {
  const new_name = (document.getElementById('dup-dir-name').value || '').trim();
  if (!new_name) { showToast('Введи название нового раздела', 'error'); return; }
  const copy_subgroups = document.getElementById('dup-dir-subgroups').checked;
  const copy_models = document.getElementById('dup-dir-models').checked;
  try {
    const r = await apiPost('/api/directions/' + directionId + '/duplicate', {
      new_name, copy_subgroups, copy_models,
    });
    const sgCnt = (r.subgroups_copied != null) ? r.subgroups_copied : 0;
    const mCnt  = (r.models_copied != null) ? r.models_copied : 0;
    showToast('Раздел создан · подгрупп: ' + sgCnt + ', моделей: ' + mCnt, 'success');
    document.getElementById('duplicate-direction-modal').classList.remove('visible');
    cache.models = null;
    if (typeof loadModels === 'function') {
      try { await loadModels(); } catch (e) {}
    }
  } catch (e) {
    showToast('Ошибка дублирования: ' + (e.message || e), 'error');
  }
}

// ============ КОНЕЦ ЭТАПА 45.1 (UI блок 3) ============


// ============ ЭТАП 45.2 (v2.33.4): УДАЛЕНИЕ РАЗДЕЛА С ПОДТВЕРЖДЕНИЕМ ПАРОЛЯ ============

async function openDeleteDirectionModal(directionId) {
  if (!canManageSales()) {
    showToast('Удаление разделов доступно директору и заму', 'error');
    return;
  }
  const dir = ((cache.models && cache.models.directions) || []).find(d => d.id === directionId);
  if (!dir) { showToast('Раздел не найден', 'error'); return; }
  const models = ((cache.models && cache.models.models) || []).filter(m => m.direction_id === directionId && m.is_active !== false);

  let overlay = document.getElementById('delete-direction-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'delete-direction-modal';
    overlay.className = 'modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('visible'); };
    document.body.appendChild(overlay);
  }

  // Если есть модели — показываем предупреждение и блокируем кнопку
  const hasModels = models.length > 0;
  const warningBlock = hasModels
    ? '<div style="background:#FEE;border:1px solid var(--danger);border-radius:8px;padding:12px 14px;margin-bottom:14px;color:#A32D2D;font-size:13px;">' +
        '<i class="ti ti-alert-triangle" style="vertical-align:-2px;margin-right:6px;"></i>' +
        '<b>В разделе ' + models.length + ' активных моделей.</b> Сначала перенесите их в другой раздел (через «Редактировать» в карточке модели) или деактивируйте.' +
      '</div>'
    : '<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:12px 14px;margin-bottom:14px;color:#854F0B;font-size:13px;">' +
        '<i class="ti ti-alert-triangle" style="vertical-align:-2px;margin-right:6px;"></i>' +
        'Раздел будет деактивирован. Это действие нельзя отменить через UI.' +
      '</div>';

  overlay.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:440px;">' +
      '<div class="modal-header">' +
        '<h3 style="color:var(--danger);"><i class="ti ti-trash"></i> Удалить раздел</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'delete-direction-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body">' +
        warningBlock +
        '<div class="form-group">' +
          '<label style="text-transform:none;font-size:14px;font-weight:500;color:var(--text-dark);">' +
            'Удаляется раздел: <b>' + escapeHtml(dir.name) + '</b>' +
          '</label>' +
        '</div>' +
        (hasModels ? '' :
          '<div class="form-group">' +
            '<label>Подтвердите паролем *</label>' +
            '<input type="password" id="del-dir-password" placeholder="Ваш пароль для входа" autocomplete="current-password" />' +
          '</div>'
        ) +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'delete-direction-modal\').classList.remove(\'visible\')">Отмена</button>' +
        (hasModels
          ? '<button class="btn btn-secondary" disabled style="background:var(--bg);color:var(--text-faint);cursor:not-allowed;"><i class="ti ti-trash"></i> Удалить</button>'
          : '<button class="btn" onclick="submitDeleteDirection(' + directionId + ')" style="background:var(--danger);color:white;"><i class="ti ti-trash"></i> Удалить</button>'
        ) +
      '</div>' +
    '</div>';
  overlay.classList.add('visible');
  setTimeout(() => {
    const p = document.getElementById('del-dir-password');
    if (p) p.focus();
  }, 50);
}

async function submitDeleteDirection(directionId) {
  const passInput = document.getElementById('del-dir-password');
  const password = passInput ? (passInput.value || '') : '';
  if (!password) { showToast('Введите пароль', 'error'); return; }
  try {
    await apiPost('/api/directions/' + directionId + '/delete-with-password', { password });
    showToast('Раздел удалён', 'success');
    document.getElementById('delete-direction-modal').classList.remove('visible');
    cache.models = null;
    if (typeof loadModels === 'function') {
      try { await loadModels(); } catch (e) {}
    }
  } catch (e) {
    const msg = e.message || String(e);
    if (msg.includes('пароль') || msg.toLowerCase().includes('password')) {
      showToast('Неверный пароль', 'error');
      if (passInput) { passInput.value = ''; passInput.focus(); }
    } else {
      showToast('Ошибка: ' + msg, 'error');
    }
  }
}

// ЭТАП 45.4 (v2.34.0): экспорт всей номенклатуры в Excel
async function exportNomenclatureXlsx() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) { showToast('Сессия истекла', 'error'); return; }
  showToast('Готовим Excel…', 'info');
  try {
    const r = await fetch(API_BASE + '/api/export/nomenclature.xlsx', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 100));
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Имя файла — из заголовка Content-Disposition либо дефолтное
    const cd = r.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="?([^"]+)"?/);
    a.download = match ? match[1] : 'atom-crm-nomenclature.xlsx';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
    showToast('Скачано', 'success');
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

// v2.45.90: Excel-сверка склада комплектующих с потребностями BOM
async function exportBomReconciliationXlsx() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) { showToast('Сессия истекла', 'error'); return; }
  showToast('Готовим сверку…', 'info');
  try {
    const r = await fetch(API_BASE + '/api/export/bom-reconciliation.xlsx', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 100));
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cd = r.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="?([^"]+)"?/);
    a.download = match ? match[1] : 'bom-reconciliation.xlsx';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    showToast('Сверка скачана', 'success');
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

// ============ КОНЕЦ ЭТАПА 45.4 ============


// ============ ЭТАП 45.5 (v2.34.1): Импорт BOM из JSON-пакета ============

function openBomImportModal() {
  let overlay = document.getElementById('bom-import-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'bom-import-modal';
    overlay.className = 'modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('visible'); };
    document.body.appendChild(overlay);
  }
  overlay.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:560px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-upload"></i> Импорт BOM</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'bom-import-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div style="background:var(--bg);border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:13px;color:var(--text-mid);">' +
          'Загрузите JSON-файл с пакетом для импорта.<br>' +
          'Файл содержит список компонентов для создания и список строк BOM.<br>' +
          'Действие безопасное: существующие компоненты пропускаются, дубликаты BOM не создаются.' +
        '</div>' +
        '<div class="form-group">' +
          '<label>JSON-файл</label>' +
          '<input type="file" id="bom-import-file" accept=".json,application/json" />' +
        '</div>' +
        '<div id="bom-import-preview" style="display:none;background:var(--brand-bg);border-radius:8px;padding:12px 14px;margin-top:10px;font-size:13px;"></div>' +
        '<div id="bom-import-result" style="display:none;margin-top:14px;"></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'bom-import-modal\').classList.remove(\'visible\')">Отмена</button>' +
        '<button class="btn btn-primary" id="bom-import-submit-btn" onclick="submitBomImport()" disabled><i class="ti ti-upload"></i> Применить</button>' +
      '</div>' +
    '</div>';
  overlay.classList.add('visible');

  // Превью при выборе файла
  const fileInput = document.getElementById('bom-import-file');
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    try {
      const txt = await f.text();
      const data = JSON.parse(txt);
      window._bomImportData = data;
      const nComp = (data.components_to_create || []).length;
      const nBom  = (data.bom || []).length;
      const preview = document.getElementById('bom-import-preview');
      preview.style.display = '';
      preview.innerHTML =
        '<b>Что будет применено:</b><br>' +
        '• Создать новых комплектующих: <b>' + nComp + '</b><br>' +
        '• Создать строк BOM: <b>' + nBom + '</b><br><br>' +
        '<span style="color:var(--text-light);font-size:12px;">' +
        'Если компонент уже есть в системе — он не создаётся повторно.<br>' +
        'Если строка BOM уже есть — она не дублируется.' +
        '</span>';
      document.getElementById('bom-import-submit-btn').disabled = false;
    } catch (e) {
      showToast('Не удалось прочитать JSON: ' + (e.message || e), 'error');
      window._bomImportData = null;
      document.getElementById('bom-import-submit-btn').disabled = true;
    }
  });
}

async function submitBomImport() {
  const data = window._bomImportData;
  if (!data) { showToast('Сначала выберите JSON-файл', 'error'); return; }
  const btn = document.getElementById('bom-import-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Применяю…';
  try {
    const resp = await apiPost('/api/import/bom-package', data);
    if (!resp.ok) {
      const msg = (resp.data && (resp.data.message || resp.data.error)) || ('HTTP ' + resp.status);
      throw new Error(msg);
    }
    const r = resp.data || {};
    const resultEl = document.getElementById('bom-import-result');
    resultEl.style.display = '';
    const compCreated = r.components_created || [];
    const compSkipped = r.components_skipped || [];
    const compErrors  = r.components_errors || [];
    const bomErrors   = r.bom_errors || [];
    const bomCreated  = (r.bom_created !== undefined) ? r.bom_created : 0;
    const bomSkipped  = (r.bom_skipped_existing !== undefined) ? r.bom_skipped_existing : 0;
    let html =
      '<div style="background:#D5E8D4;border-radius:8px;padding:12px 14px;font-size:13px;color:#0A5B41;">' +
        '<b>Импорт завершён.</b><br>' +
        '• Создано комплектующих: <b>' + compCreated.length + '</b><br>' +
        '• Уже существовало: <b>' + compSkipped.length + '</b><br>' +
        '• Создано строк BOM: <b>' + bomCreated + '</b><br>' +
        '• Пропущено дубликатов BOM: <b>' + bomSkipped + '</b>' +
      '</div>';
    if (compErrors.length || bomErrors.length) {
      html += '<div style="background:#FEE;border-radius:8px;padding:12px 14px;margin-top:10px;font-size:12px;color:#A32D2D;">' +
                '<b>Ошибки (' + (compErrors.length + bomErrors.length) + '):</b><br>';
      compErrors.slice(0, 20).forEach(e => {
        html += '• Компонент «' + escapeHtml(e.name || '') + '»: ' + escapeHtml(e.error || '') + '<br>';
      });
      bomErrors.slice(0, 20).forEach(e => {
        html += '• BOM ' + escapeHtml(e.model_art || '') + ' / ' + escapeHtml(e.component_name || '') + ': ' + escapeHtml(e.error || '') + '<br>';
      });
      if (compErrors.length + bomErrors.length > 40) {
        html += '<br><i>...и ещё ' + (compErrors.length + bomErrors.length - 40) + '</i>';
      }
      html += '</div>';
    }
    resultEl.innerHTML = html;
    btn.innerHTML = '<i class="ti ti-check"></i> Готово';
    showToast('Импорт применён', 'success');
    cache.models = null;
    cache.components = null;
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-upload"></i> Применить';
  }
}

// ============ КОНЕЦ ЭТАПА 45.5 ============

async function loadModelBom(modelId) {
  const container = document.getElementById('bom-list');
  if (!container) return;
  try {
    const r = await apiGet('/api/models/' + modelId + '/bom');
    const items = r.items || [];
    if (!items.length) {
      container.innerHTML = '<div class="empty-block" style="padding:30px 0;">' +
        '<i class="ti ti-list-search"></i>Тех. карта пуста. ' +
        (canManageSales() ? 'Жми «+ Позиция» чтобы добавить комплектующее.' : '') +
        '</div>';
      return;
    }
    // v2.45.28: сохраняем строки BOM в state — клик по edit/delete будет читать
    // данные по bom_id без эскейпинга имён в onclick (раньше ломалось на именах
    // с кавычками и точкой с запятой, например «TRN 8/6-R "РИЛСАН"; D1=…»).
    state._bomItemsById = {};
    items.forEach(it => { state._bomItemsById[it.id] = it; });
    state._currentBomModelId = modelId;
    // v2.45.229: панель массового выбора/удаления позиций BOM
    let html = '';
    if (canManageSales()) {
      html += '<div style="display:flex;align-items:center;gap:10px;padding:6px 2px 10px;flex-wrap:wrap;">' +
        '<label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-light);cursor:pointer;">' +
          '<input type="checkbox" id="bom-check-all" onchange="_bomToggleAll(this)" style="width:auto;"> выбрать все' +
        '</label>' +
        '<button class="btn btn-secondary btn-small" id="bom-bulk-del-btn" style="display:none;color:var(--danger);" ' +
          'onclick="bulkDeleteBomItems(' + modelId + ')"><i class="ti ti-trash"></i> Удалить выбранные (<span id="bom-bulk-count">0</span>)</button>' +
      '</div>';
    }
    html += '<div class="bom-table">';
    items.forEach(it => {
      // v2.45.24: строка может быть «компонент» или «подсборка» (kind='model')
      const isModel = (it.kind === 'model');
      const have = parseFloat((isModel ? it.child_model_qty : it.component_qty) || 0);
      const need = parseFloat(it.qty_required || 0);
      const lowFlag = have < need;
      // v2.20.0: явный бейдж дефицита
      let stockBadge = '';
      if (need > 0) {
        if (have >= need) {
          stockBadge = ' <span class="bom-stock-badge bsb-ok" title="Достаточно для сборки"><i class="ti ti-circle-check"></i>В наличии</span>';
        } else if (have > 0) {
          const shortBy = _fmtQty(need - have);
          stockBadge = ' <span class="bom-stock-badge bsb-empty" title="Хватит только на часть"><i class="ti ti-alert-triangle"></i>Не хватает: ' + shortBy + '</span>';
        } else {
          stockBadge = ' <span class="bom-stock-badge bsb-shortage" title="На складе нет"><i class="ti ti-shopping-cart"></i>' + (isModel ? 'Нужно собрать' : 'К закупке') + '</span>';
        }
      }
      // Имя: для компонента — как раньше; для подсборки — c подкатегорией «Подсборка»
      const displayName = isModel
        ? ('<i class="ti ti-package" style="color:var(--brand);margin-right:4px;" title="Подсборка"></i>' + escapeHtml(it.child_model_name || '—'))
        : _highlightAisi(it.component_name || '—');
      const skuPart = isModel
        ? (it.child_model_article ? ' <span class="comp-sku">' + escapeHtml(it.child_model_article) + '</span>' : '')
        : (it.component_sku       ? ' <span class="comp-sku">' + escapeHtml(it.component_sku)        + '</span>' : '');
      const unitLbl = isModel ? 'сборка' : (it.unit_override || it.component_unit || 'шт.');
      const categoryPart = isModel
        ? '<span class="comp-cat-badge" style="background:#EAF4EE;color:#0A5B41;">Подсборка</span>'
        : (it.category_name ? '<span class="comp-cat-badge">' + escapeHtml(it.category_name) + '</span>' : '');
      // v2.45.28: открываем редактор по bom_id — данные тянем из state, без эскейпинга
      const editCall = 'openBomEditItemById(' + it.id + ')';
      html += '<div class="bom-row">' +
        '<div class="bom-row-main">' +
          '<div class="bom-name">' +
            (canManageSales() ? '<input type="checkbox" class="bom-check" data-bomid="' + it.id + '" onchange="_bomBulkUpdate()" style="width:auto;margin-right:8px;vertical-align:-2px;cursor:pointer;">' : '') +
            displayName + skuPart +
            (it.is_critical ? ' <span class="bom-critical" title="Критичное">★</span>' : '') +
            stockBadge +
          '</div>' +
          '<div class="bom-meta">' +
            categoryPart +
            (it.comment ? ' · ' + escapeHtml(it.comment) : '') +
          '</div>' +
        '</div>' +
        '<div class="bom-qty"><div class="bom-qty-num">' + _fmtQty(need) + '</div>' +
          '<div class="bom-qty-lbl">' + escapeHtml(unitLbl) + ' / ед.</div></div>' +
        '<div class="bom-stock' + (lowFlag ? ' low' : '') + '"><div class="bom-stock-num">' + _fmtQty(have) + '</div>' +
          '<div class="bom-qty-lbl">в наличии</div></div>' +
        (canManageSales() ?
          '<div class="bom-actions">' +
            '<button class="btn btn-secondary btn-small" onclick="' + editCall + '" title="Изменить"><i class="ti ti-edit"></i></button>' +
            '<button class="btn btn-secondary btn-small" onclick="deleteBomItem(' + it.id + ',' + modelId + ')" title="Удалить" style="color:var(--danger);"><i class="ti ti-trash"></i></button>' +
          '</div>' : '<div></div>') +
      '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="empty-block">Ошибка загрузки</div>';
  }
}

// v2.45.229: массовый выбор и удаление позиций BOM
function _bomToggleAll(cb) {
  document.querySelectorAll('.bom-check').forEach(c => { c.checked = cb.checked; });
  _bomBulkUpdate();
}
function _bomBulkUpdate() {
  const checked = document.querySelectorAll('.bom-check:checked').length;
  const btn = document.getElementById('bom-bulk-del-btn');
  const cnt = document.getElementById('bom-bulk-count');
  if (cnt) cnt.textContent = checked;
  if (btn) btn.style.display = checked > 0 ? '' : 'none';
}
async function bulkDeleteBomItems(modelId) {
  const ids = [...document.querySelectorAll('.bom-check:checked')].map(c => parseInt(c.getAttribute('data-bomid')));
  if (!ids.length) return;
  if (!confirm('Удалить выбранные позиции из тех. карты (' + ids.length + ' шт.)?')) return;
  const btn = document.getElementById('bom-bulk-del-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i> Удаляем…'; }
  let ok = 0, fail = 0;
  const token = localStorage.getItem(TOKEN_KEY);
  for (const id of ids) {
    try {
      const r = await fetch(API_BASE + '/api/bom/' + id, {
        method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token },
      });
      if (r.ok) ok++; else fail++;
    } catch (e) { fail++; }
  }
  showToast('Удалено: ' + ok + (fail ? ' · не удалось: ' + fail : ''), fail ? 'error' : 'success');
  loadModelBom(modelId);
}

async function openBomAddItem(modelId) {
  if (!cache.components) {
    try { const r = await apiGet('/api/components'); cache.components = r.components || []; }
    catch (e) { cache.components = []; }
  }
  if (!cache.componentCategories) {
    try { const r = await apiGet('/api/components/categories'); cache.componentCategories = r.categories || []; }
    catch (e) { cache.componentCategories = []; }
  }
  // ЭТАП 32.1: убрана блокировка — если каталог пуст, юзер создаст комплектующее прямо здесь
  // ЭТАП 33.1: вместо <select> — кнопка-picker с поиском и сворачиваемыми категориями
  let m = document.getElementById('bom-add-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'bom-add-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  // Сбрасываем выбранное комплектующее / подсборку (v2.45.24)
  state._bomSelectedComponentId = null;
  state._bomSelectedChildModelId = null;
  state._bomAddKind = 'component'; // 'component' | 'model'
  const hasComponents = cache.components.length > 0;
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:520px;">' +
      '<div class="modal-header"><h3><i class="ti ti-plus"></i> Позиция в тех. карту</h3>' +
        '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button></div>' +
      '<div style="padding:18px;">' +
        // v2.45.24: переключатель «Комплектующее / Подсборка»
        '<div style="display:flex;gap:0;background:var(--bg);border-radius:10px;padding:4px;margin-bottom:14px;">' +
          '<button type="button" id="bom-kind-component" onclick="switchBomAddKind(\'component\',' + modelId + ')" ' +
            'style="flex:1;padding:8px 10px;border:none;border-radius:7px;background:white;font-weight:600;color:var(--text-dark);cursor:pointer;font-size:13px;">' +
            '<i class="ti ti-puzzle"></i> Комплектующее</button>' +
          '<button type="button" id="bom-kind-model" onclick="switchBomAddKind(\'model\',' + modelId + ')" ' +
            'style="flex:1;padding:8px 10px;border:none;border-radius:7px;background:transparent;font-weight:600;color:var(--text-mid);cursor:pointer;font-size:13px;">' +
            '<i class="ti ti-package"></i> Подсборка</button>' +
        '</div>' +
        // Picker для компонента (виден по умолчанию)
        '<div id="bom-picker-component-block">' +
          '<label class="form-label">Комплектующее *</label>' +
          '<div style="display:flex;gap:8px;margin-bottom:14px;">' +
            '<button type="button" id="bom-component-btn" class="form-input" ' +
              'onclick="openBomComponentPicker(' + modelId + ')" ' +
              'style="flex:1;margin:0;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;background:white;">' +
              '<span style="color:var(--text-light);">' +
                (hasComponents ? 'Выбрать из каталога…' : 'Каталог пуст, создай новое →') +
              '</span>' +
              '<i class="ti ti-chevron-down" style="color:var(--text-light);"></i>' +
            '</button>' +
            '<button type="button" class="btn btn-secondary" onclick="openQuickComponentForm(' + modelId + ')" title="Создать новое комплектующее">' +
              '<i class="ti ti-plus"></i> Новое' +
            '</button>' +
          '</div>' +
        '</div>' +
        // Picker для подсборки (модели) — скрыт по умолчанию
        '<div id="bom-picker-model-block" style="display:none;">' +
          '<label class="form-label">Подсборка (модель из каталога) *</label>' +
          '<button type="button" id="bom-model-btn" class="form-input" ' +
            'onclick="openBomModelPicker(' + modelId + ')" ' +
            'style="width:100%;margin:0 0 14px 0;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;background:white;">' +
            '<span style="color:var(--text-light);">Выбрать модель…</span>' +
            '<i class="ti ti-chevron-down" style="color:var(--text-light);"></i>' +
          '</button>' +
          '<div style="font-size:11.5px;color:var(--text-light);margin-top:-8px;margin-bottom:14px;">Семантика: при сборке этой модели берём <b>N готовых сборок</b> выбранной модели со склада. Если их нет — система покажет «нужно собрать N штук».</div>' +
        '</div>' +
        // Поле «Количество + единица» (единица скрыта для подсборки)
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:6px;" id="bom-qty-unit-grid">' +
          '<div>' +
            '<label class="form-label">Количество на 1 ед. *</label>' +
            '<input type="number" id="bom-qty" class="form-input" value="1" min="0.01" step="0.01" />' +
          '</div>' +
          '<div id="bom-unit-block">' +
            // v2.45.23: можно переопределить единицу для этой строки BOM
            '<label class="form-label">Единица (можно сменить)</label>' +
            '<input type="text" id="bom-unit-override" class="form-input" list="bom-unit-list" placeholder="из карточки комплектующего" />' +
            '<datalist id="bom-unit-list">' +
              ['шт.', 'м', 'м²', 'м³', 'кг', 'г', 'л', 'мл', 'упак.', 'компл.', 'рул.']
                .map(u => '<option value="' + u + '"></option>').join('') +
            '</datalist>' +
          '</div>' +
        '</div>' +
        '<div id="bom-unit-hint" style="font-size:11.5px;color:var(--text-light);margin-bottom:14px;">Пусто = единица берётся из карточки компонента. Заполните, если в этой модели нужно другое (например, трубки в метрах).</div>' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:14px;background:var(--bg);padding:10px;border-radius:8px;">' +
          '<input type="checkbox" id="bom-critical" checked />' +
          '<span><b>Критичное</b> — без него сборка не создаётся</span></label>' +
        '<label class="form-label">Комментарий</label>' +
        '<input type="text" id="bom-comment" class="form-input" placeholder="" />' +
      '</div>' +
      '<div style="padding:14px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn btn-secondary" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitBomAddItem(' + modelId + ')"><i class="ti ti-check"></i> Добавить</button>' +
      '</div></div>';
  m.classList.add('visible');
}

// v2.45.24: переключатель типа строки BOM
function switchBomAddKind(kind, modelId) {
  state._bomAddKind = kind;
  const btnC = document.getElementById('bom-kind-component');
  const btnM = document.getElementById('bom-kind-model');
  const blockC = document.getElementById('bom-picker-component-block');
  const blockM = document.getElementById('bom-picker-model-block');
  const unitBlock = document.getElementById('bom-unit-block');
  const unitHint = document.getElementById('bom-unit-hint');
  const qtyGrid = document.getElementById('bom-qty-unit-grid');
  if (kind === 'model') {
    btnC.style.background = 'transparent'; btnC.style.color = 'var(--text-mid)';
    btnM.style.background = 'white';       btnM.style.color = 'var(--text-dark)';
    blockC.style.display = 'none';
    blockM.style.display = 'block';
    if (unitBlock) unitBlock.style.display = 'none';
    if (qtyGrid) qtyGrid.style.gridTemplateColumns = '1fr';
    if (unitHint) unitHint.style.display = 'none';
    state._bomSelectedComponentId = null;
  } else {
    btnC.style.background = 'white';       btnC.style.color = 'var(--text-dark)';
    btnM.style.background = 'transparent'; btnM.style.color = 'var(--text-mid)';
    blockC.style.display = 'block';
    blockM.style.display = 'none';
    if (unitBlock) unitBlock.style.display = 'block';
    if (qtyGrid) qtyGrid.style.gridTemplateColumns = '1fr 1fr';
    if (unitHint) unitHint.style.display = 'block';
    state._bomSelectedChildModelId = null;
  }
}

// ============ ЭТАП 33.1: PICKER комплектующего с поиском и категориями ============

function openBomComponentPicker(modelId) {
  const comps = cache.components || [];
  if (!comps.length) {
    showToast('Каталог пуст. Жми «+ Новое» чтобы создать комплектующее', 'error');
    return;
  }
  // Состояние раскрытости категорий и текущий поиск
  if (!state._bomPickerOpenCats) {
    // По умолчанию: первая категория раскрыта, остальные свёрнуты
    state._bomPickerOpenCats = {};
    const cats = Array.from(new Set(comps.map(c => c.category_name || '—')));
    cats.forEach((cat, i) => { state._bomPickerOpenCats[cat] = (i === 0); });
  }
  state._bomPickerSearch = '';

  let m = document.getElementById('bom-comp-picker-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'bom-comp-picker-modal';
    m.className = 'modal-overlay';
    m.style.zIndex = '10001'; // поверх bom-add-modal
    m.onclick = (e) => { if (e.target === m) closeBomComponentPicker(); };
    document.body.appendChild(m);
  }
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:560px;max-height:85vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-search"></i> Выбрать комплектующее</h3>' +
        '<button class="modal-close" onclick="closeBomComponentPicker()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:14px 18px 0;">' +
        '<div class="search-box">' +
          '<i class="ti ti-search"></i>' +
          '<input type="text" id="bom-picker-search" placeholder="Поиск по названию или артикулу…" oninput="renderBomComponentPicker()" />' +
        '</div>' +
      '</div>' +
      '<div id="bom-picker-list" style="overflow-y:auto;flex:1;padding:14px 18px;">' +
        '<div class="loading-block">Загружаем…</div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  setTimeout(() => {
    const inp = document.getElementById('bom-picker-search');
    if (inp) inp.focus();
    renderBomComponentPicker();
  }, 50);
}

function closeBomComponentPicker() {
  const m = document.getElementById('bom-comp-picker-modal');
  if (m) m.classList.remove('visible');
}

function renderBomComponentPicker() {
  const container = document.getElementById('bom-picker-list');
  if (!container) return;
  const q = ((document.getElementById('bom-picker-search') || {}).value || '').toLowerCase().trim();
  state._bomPickerSearch = q;
  const comps = (cache.components || []).filter(c => {
    if (!q) return true;
    return (c.name || '').toLowerCase().includes(q) ||
           (c.sku || '').toLowerCase().includes(q);
  });
  if (!comps.length) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-search-off"></i>Ничего не найдено</div>';
    return;
  }
  // Группируем по категориям
  const groups = {};
  comps.forEach(c => {
    const cat = c.category_name || '—';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(c);
  });
  const catNames = Object.keys(groups);
  // При поиске — все группы раскрыты
  const allOpen = !!q;
  let html = '';
  catNames.forEach(cat => {
    const isOpen = allOpen || !!state._bomPickerOpenCats[cat];
    const items = groups[cat];
    html += '<div class="bom-picker-group">' +
      '<button type="button" class="bom-picker-toggle' + (isOpen ? ' open' : '') + '" ' +
        'onclick="toggleBomPickerGroup(\'' + cat.replace(/'/g, "\\'") + '\')">' +
        '<i class="ti ti-chevron-right bom-picker-chev"></i>' +
        '<span>' + escapeHtml(cat) + '</span>' +
        '<span class="bom-picker-count">' + items.length + '</span>' +
      '</button>' +
      '<div class="bom-picker-body"' + (isOpen ? '' : ' style="display:none;"') + '>';
    items.forEach(c => {
      html += '<button type="button" class="bom-picker-item" onclick="selectBomComponent(' + c.id + ')">' +
        '<div class="bom-picker-item-name">' + escapeHtml(c.name || '—') + '</div>' +
        '<div class="bom-picker-item-meta">' +
          (c.sku ? escapeHtml(c.sku) + ' · ' : '') +
          'остаток: ' + _fmtQty(c.qty_on_stock) + ' ' + escapeHtml(c.unit || 'шт.') +
          (c.default_supplier_name ? ' · ' + escapeHtml(c.default_supplier_name) : '') +
        '</div>' +
      '</button>';
    });
    html += '</div></div>';
  });
  container.innerHTML = html;
}

function toggleBomPickerGroup(cat) {
  // При поиске игнорируем (все открыты)
  if (state._bomPickerSearch) return;
  state._bomPickerOpenCats[cat] = !state._bomPickerOpenCats[cat];
  renderBomComponentPicker();
}

function selectBomComponent(componentId) {
  const c = (cache.components || []).find(x => x.id === componentId);
  if (!c) return;
  state._bomSelectedComponentId = componentId;
  // Обновляем кнопку-picker в форме
  const btn = document.getElementById('bom-component-btn');
  if (btn) {
    btn.innerHTML =
      '<span style="color:var(--text);font-weight:500;">' + escapeHtml(c.name) +
        (c.sku ? ' <span style="color:var(--text-light);font-weight:400;font-family:monospace;font-size:12px;">' + escapeHtml(c.sku) + '</span>' : '') +
      '</span>' +
      '<i class="ti ti-chevron-down" style="color:var(--text-light);"></i>';
  }
  closeBomComponentPicker();
}

// ============ v2.45.24: PICKER подсборки (модели из каталога) ============

async function openBomModelPicker(parentModelId) {
  // Загружаем модели если ещё нет в кэше
  if (!cache.modelsForBom) {
    try {
      const r = await apiGet('/api/models');
      // /api/models отдаёт {models:[{id,name,article,direction_id,is_active}, ...], directions:[...]}
      const dirById = {};
      (r.directions || []).forEach(d => { dirById[d.id] = d.name || ''; });
      const list = (r.models || [])
        .filter(mo => mo.is_active !== false && mo.is_active !== 0)
        .map(mo => ({
          id: mo.id,
          name: mo.name,
          article: mo.article || '',
          direction_name: dirById[mo.direction_id] || '—',
        }));
      cache.modelsForBom = list;
    } catch (e) { cache.modelsForBom = []; }
  }
  state._bomModelPickerSearch = '';
  state._bomModelParentId = parentModelId;
  let m = document.getElementById('bom-model-picker-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'bom-model-picker-modal';
    m.className = 'modal-overlay';
    m.style.zIndex = '10001';
    m.onclick = (e) => { if (e.target === m) closeBomModelPicker(); };
    document.body.appendChild(m);
  }
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:560px;max-height:85vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-package"></i> Выбрать подсборку</h3>' +
        '<button class="modal-close" onclick="closeBomModelPicker()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:14px 18px 0;">' +
        '<div class="search-box">' +
          '<i class="ti ti-search"></i>' +
          '<input type="text" id="bom-model-picker-search" placeholder="Поиск по названию или артикулу…" oninput="renderBomModelPicker()" />' +
        '</div>' +
      '</div>' +
      '<div id="bom-model-picker-list" style="overflow-y:auto;flex:1;padding:14px 18px;">' +
        '<div class="loading-block">Загружаем…</div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  setTimeout(() => {
    const inp = document.getElementById('bom-model-picker-search');
    if (inp) inp.focus();
    renderBomModelPicker();
  }, 50);
}

function closeBomModelPicker() {
  const m = document.getElementById('bom-model-picker-modal');
  if (m) m.classList.remove('visible');
}

function renderBomModelPicker() {
  const container = document.getElementById('bom-model-picker-list');
  if (!container) return;
  const q = ((document.getElementById('bom-model-picker-search') || {}).value || '').toLowerCase().trim();
  state._bomModelPickerSearch = q;
  const parentId = state._bomModelParentId;
  const list = (cache.modelsForBom || []).filter(mo => {
    if (mo.id === parentId) return false; // нельзя сам в себя
    if (!q) return true;
    return (mo.name || '').toLowerCase().includes(q) ||
           (mo.article || '').toLowerCase().includes(q);
  });
  if (!list.length) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-search-off"></i>Ничего не найдено</div>';
    return;
  }
  // Группируем по направлению
  const groups = {};
  list.forEach(mo => {
    const d = mo.direction_name || '—';
    if (!groups[d]) groups[d] = [];
    groups[d].push(mo);
  });
  let html = '';
  Object.keys(groups).forEach(dir => {
    html += '<div class="bom-picker-group">' +
      '<div class="bom-picker-toggle open" style="cursor:default;">' +
        '<i class="ti ti-folder" style="opacity:0.6;"></i>' +
        '<span>' + escapeHtml(dir) + '</span>' +
        '<span class="bom-picker-count">' + groups[dir].length + '</span>' +
      '</div>' +
      '<div class="bom-picker-body">';
    groups[dir].forEach(mo => {
      html += '<button type="button" class="bom-picker-item" onclick="selectBomChildModel(' + mo.id + ')">' +
        '<div class="bom-picker-item-name">' + escapeHtml(mo.name) + '</div>' +
        '<div class="bom-picker-item-meta">' +
          (mo.article ? escapeHtml(mo.article) : '') +
        '</div>' +
      '</button>';
    });
    html += '</div></div>';
  });
  container.innerHTML = html;
}

function selectBomChildModel(modelId) {
  const mo = (cache.modelsForBom || []).find(x => x.id === modelId);
  if (!mo) return;
  state._bomSelectedChildModelId = modelId;
  const btn = document.getElementById('bom-model-btn');
  if (btn) {
    btn.innerHTML =
      '<span style="color:var(--text);font-weight:500;">' + escapeHtml(mo.name) +
        (mo.article ? ' <span style="color:var(--text-light);font-weight:400;font-family:monospace;font-size:12px;">' + escapeHtml(mo.article) + '</span>' : '') +
      '</span>' +
      '<i class="ti ti-chevron-down" style="color:var(--text-light);"></i>';
  }
  closeBomModelPicker();
}

// ЭТАП 32.1: быстрое создание комплектующего из формы BOM
async function openQuickComponentForm(modelId) {
  const cats = cache.componentCategories || [];
  // Подгружаем поставщиков
  if (!cache.suppliers) {
    try {
      const r = await apiGet('/api/suppliers');
      cache.suppliers = r.suppliers || [];
    } catch (e) { cache.suppliers = []; }
  }
  const suppliers = cache.suppliers || [];

  let m = document.getElementById('quick-comp-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'quick-comp-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  const catOptions = cats.map(cat =>
    '<option value="' + cat.id + '">' + escapeHtml(cat.name) + '</option>'
  ).join('');
  const supOptions = '<option value="">— Не указан —</option>' +
    suppliers.map(s => '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>').join('');
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:460px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-tool"></i> Быстро создать комплектующее</h3>' +
        '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:18px;">' +
        '<label class="form-label">Категория *</label>' +
        '<select id="qc-category" class="form-input" style="margin-bottom:14px;">' + catOptions + '</select>' +
        '<label class="form-label">Название *</label>' +
        '<input type="text" id="qc-name" class="form-input" placeholder="Например: Реле РЭК-77/4" style="margin-bottom:14px;" />' +
        '<div style="display:flex;gap:10px;margin-bottom:14px;">' +
          '<div style="flex:2;"><label class="form-label">Артикул</label>' +
            '<input type="text" id="qc-sku" class="form-input" /></div>' +
          '<div style="flex:1;"><label class="form-label">Ед.</label>' +
            '<select id="qc-unit" class="form-input">' +
              ['шт.','м','кг','л','компл.','уп.','м²'].map(u =>
                '<option' + (u === 'шт.' ? ' selected' : '') + '>' + u + '</option>'
              ).join('') +
            '</select></div>' +
        '</div>' +
        '<label class="form-label">Поставщик</label>' +
        '<select id="qc-supplier" class="form-input">' + supOptions + '</select>' +
        '<div style="font-size:12px;color:var(--text-light);padding-top:8px;">' +
          'Будет создано в каталоге Склад → Комплектующие. Остаток на складе = 0, оприходовать можно потом.' +
        '</div>' +
      '</div>' +
      '<div style="padding:14px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn btn-secondary" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitQuickComponent(' + modelId + ')"><i class="ti ti-check"></i> Создать и выбрать</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  setTimeout(() => { const n = document.getElementById('qc-name'); if (n) n.focus(); }, 50);
}

async function submitQuickComponent(modelId) {
  const supVal = (document.getElementById('qc-supplier') || {}).value || '';
  const data = {
    category_id: parseInt(document.getElementById('qc-category').value),
    name: (document.getElementById('qc-name').value || '').trim(),
    sku: (document.getElementById('qc-sku').value || '').trim(),
    unit: document.getElementById('qc-unit').value,
    default_supplier_id: supVal ? parseInt(supVal) : null,
  };
  if (!data.name) { showToast('Укажи название', 'error'); return; }
  if (!data.category_id) { showToast('Выбери категорию', 'error'); return; }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/components', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось создать', 'error');
      return;
    }
    const created = await r.json();
    // Закрываем quick-форму
    document.getElementById('quick-comp-modal').classList.remove('visible');
    // Обновляем кеш
    cache.components = null;
    try {
      const cr = await apiGet('/api/components');
      cache.components = cr.components || [];
    } catch (e) { /* ignore */ }
    // Переоткрываем BOM-форму и выбираем созданное через picker-state
    document.getElementById('bom-add-modal').classList.remove('visible');
    await openBomAddItem(modelId);
    if (created.id) {
      selectBomComponent(created.id);
    }
    showToast('Создано: ' + created.name, 'success');
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function submitBomAddItem(modelId) {
  const kind = state._bomAddKind || 'component';
  const qty_required = parseFloat(document.getElementById('bom-qty').value);
  const is_critical = document.getElementById('bom-critical').checked;
  const comment = (document.getElementById('bom-comment').value || '').trim();
  // v2.45.23: единица переопределяется на уровне BOM-строки (пусто = из компонента)
  const unit_override = (document.getElementById('bom-unit-override')?.value || '').trim();
  // v2.45.24: для подсборки шлём child_model_id
  const payload = { qty_required, is_critical, comment };
  if (kind === 'model') {
    if (!state._bomSelectedChildModelId) { showToast('Выбери подсборку из каталога', 'error'); return; }
    payload.child_model_id = state._bomSelectedChildModelId;
  } else {
    if (!state._bomSelectedComponentId) { showToast('Выбери комплектующее из каталога', 'error'); return; }
    payload.component_id = state._bomSelectedComponentId;
    payload.unit_override = unit_override;
  }
  if (isNaN(qty_required) || qty_required <= 0) {
    showToast('Укажи количество', 'error'); return;
  }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/models/' + modelId + '/bom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось добавить', 'error'); return;
    }
    showToast('Добавлено в тех. карту', 'success');
    document.getElementById('bom-add-modal').classList.remove('visible');
    state._bomSelectedComponentId = null;
    await loadModelBom(modelId);
  } catch (e) { showToast('Ошибка', 'error'); }
}

// v2.43.81: добавлено редактирование названия компонента прямо из BOM.
// Имя живёт на самом компоненте (таблица components), поэтому переименование
// затрагивает все модели, где этот компонент стоит.
// v2.45.28: открыть редактор BOM-строки по её id — данные берём из state (там
// они уже без эскейпинга), это устойчиво к именам с кавычками и `;`.
function openBomEditItemById(bomId) {
  const it = (state._bomItemsById || {})[bomId];
  if (!it) { showToast('Не нашли строку BOM в кэше — перезагрузи страницу', 'error'); return; }
  const isModel = (it.kind === 'model');
  const need = parseFloat(it.qty_required || 0);
  if (isModel) {
    openBomEditItem(it.id, need, !!it.is_critical, it.comment || '', 0, '', '', '', true);
  } else {
    openBomEditItem(
      it.id, need, !!it.is_critical, it.comment || '',
      it.component_id || 0,
      it.component_name || '',
      it.unit_override || '',
      it.component_unit || '',
      false,
    );
  }
}

function openBomEditItem(bomId, qty, isCritical, comment, componentId, componentName, unitOverride, componentUnit, isModel) {
  let m = document.getElementById('bom-edit-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'bom-edit-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  const cName = componentName || '';
  const cId = componentId || 0;
  const uOver = (unitOverride || '').trim();
  const cUnit = (componentUnit || 'шт.').trim();
  // v2.45.23: список типовых единиц + плейсхолдер с базовой ед. компонента
  const unitOpts = ['шт.', 'м', 'м²', 'м³', 'кг', 'г', 'л', 'мл', 'упак.', 'компл.', 'рул.'];
  // v2.45.24: для строки-«подсборки» имя/единицу менять нечего (живут на самой
  // дочерней модели, переименуй её отдельно), показываем только qty/crit/comment.
  const headerBlock = isModel
    ? '<div style="padding:12px 14px;background:#EAF4EE;color:#0A5B41;border-radius:8px;margin-bottom:14px;font-size:13px;"><i class="ti ti-package"></i> Это подсборка. Имя и артикул живут на самой модели — переименуй её в каталоге.</div>'
    : ('<label class="form-label">Название компонента</label>' +
       '<input type="text" id="bome-name" class="form-input" value="' + escapeHtml(cName) + '" data-orig="' + escapeHtml(cName) + '" style="margin-bottom:6px;" />' +
       '<div style="font-size:11.5px;color:var(--text-light);margin-bottom:14px;">Переименование затронет ВСЕ модели, где этот компонент используется (он живёт в общем справочнике).</div>');
  const qtyUnitBlock = isModel
    ? ('<label class="form-label">Количество подсборок на 1 ед. *</label>' +
       '<input type="number" id="bome-qty" class="form-input" value="' + qty + '" min="0.01" step="0.01" style="margin-bottom:14px;" />')
    : ('<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:6px;">' +
         '<div>' +
           '<label class="form-label">Количество на 1 ед. *</label>' +
           '<input type="number" id="bome-qty" class="form-input" value="' + qty + '" min="0.01" step="0.01" />' +
         '</div>' +
         '<div>' +
           '<label class="form-label">Единица в этой модели</label>' +
           '<input type="text" id="bome-unit-override" class="form-input" list="bome-unit-list" value="' + escapeHtml(uOver) + '" placeholder="' + escapeHtml(cUnit) + ' (как в карточке)" />' +
           '<datalist id="bome-unit-list">' + unitOpts.map(u => '<option value="' + u + '"></option>').join('') + '</datalist>' +
         '</div>' +
       '</div>' +
       '<div style="font-size:11.5px;color:var(--text-light);margin-bottom:14px;">Базовая единица компонента: <b>' + escapeHtml(cUnit) + '</b>. Если в этой модели измеряется иначе (например, трубки в метрах) — впишите сюда. Пусто = брать из компонента.</div>');
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:480px;">' +
      '<div class="modal-header"><h3><i class="ti ti-edit"></i> Изменить позицию</h3>' +
        '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button></div>' +
      '<div style="padding:18px;">' +
        headerBlock +
        qtyUnitBlock +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:14px;background:var(--bg);padding:10px;border-radius:8px;">' +
          '<input type="checkbox" id="bome-critical"' + (isCritical ? ' checked' : '') + ' />' +
          '<span><b>Критичное</b></span></label>' +
        '<label class="form-label">Комментарий</label>' +
        '<input type="text" id="bome-comment" class="form-input" value="' + escapeHtml(comment) + '" />' +
      '</div>' +
      '<div style="padding:14px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn btn-secondary" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitBomEditItem(' + bomId + ',' + cId + ')"><i class="ti ti-check"></i> Сохранить</button>' +
      '</div></div>';
  m.classList.add('visible');
}

async function submitBomEditItem(bomId, componentId) {
  const qty_required = parseFloat(document.getElementById('bome-qty').value);
  const is_critical = document.getElementById('bome-critical').checked;
  const comment = (document.getElementById('bome-comment').value || '').trim();
  // v2.45.23: пустая строка → NULL → fallback на components.unit
  const unit_override = (document.getElementById('bome-unit-override')?.value || '').trim();
  const nameInp = document.getElementById('bome-name');
  const newName = (nameInp && nameInp.value || '').trim();
  const origName = (nameInp && nameInp.dataset.orig || '').trim();
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    // 1) Имя — если поменялось, PATCH-им компонент в справочнике
    if (componentId && newName && newName !== origName) {
      const rn = await fetch(API_BASE + '/api/components/' + componentId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ name: newName }),
      });
      if (!rn.ok) { showToast('Не удалось переименовать компонент', 'error'); return; }
    }
    // 2) qty / critical / comment / unit_override — патчим BOM-строку
    const r = await fetch(API_BASE + '/api/bom/' + bomId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ qty_required, is_critical, comment, unit_override }),
    });
    if (!r.ok) { showToast('Не удалось сохранить', 'error'); return; }
    showToast('Сохранено', 'success');
    document.getElementById('bom-edit-modal').classList.remove('visible');
    if (state._currentBomModelId) await loadModelBom(state._currentBomModelId);
    // Сбрасываем кэш каталога компонентов — имя могло измениться
    cache.components = null;
  } catch (e) { showToast('Ошибка', 'error'); }
}

async function deleteBomItem(bomId, modelId) {
  if (!confirm('Удалить позицию из тех. карты?')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/bom/' + bomId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) { showToast('Не удалось удалить', 'error'); return; }
    showToast('Удалено', 'success');
    await loadModelBom(modelId);
  } catch (e) { showToast('Ошибка', 'error'); }
}


function toggleModelsSubgroup(subKey) {
  const body = document.querySelector('.models-subgroup-body[data-subkey="' + subKey + '"]');
  const toggle = document.querySelector('.models-subgroup-toggle[data-subkey="' + subKey + '"]');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? '' : 'none';
  if (toggle) {
    const chev = toggle.querySelector('.models-subgroup-chevron');
    if (chev) chev.classList.toggle('open', isHidden);
  }
  const openMap = JSON.parse(localStorage.getItem('models_subgroups_open') || '{}');
  openMap[subKey] = isHidden;
  localStorage.setItem('models_subgroups_open', JSON.stringify(openMap));
}

function toggleModelsGroup(dirId) {
  const body = document.querySelector('.models-group-body[data-dirid="' + dirId + '"]');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? '' : 'none';
  // Поворот шеврона
  const toggle = body.previousElementSibling;
  if (toggle) {
    const chevron = toggle.querySelector('.models-group-chevron');
    if (chevron) chevron.classList.toggle('open', isHidden);
  }
  // Сохраняем состояние
  const openMap = JSON.parse(localStorage.getItem('models_groups_open') || '{}');
  openMap[dirId] = isHidden;
  localStorage.setItem('models_groups_open', JSON.stringify(openMap));
}

// ============ ЭТАП 30.6: создание новой модели ============

function openNewModelForm() {
  if (!canManageSales()) {
    showToast('Создавать модели может директор или зам', 'error');
    return;
  }
  const directions = (cache.models && cache.models.directions) || [];
  if (!directions.length) {
    showToast('Сначала загрузите номенклатуру', 'error');
    return;
  }
  let m = document.getElementById('new-model-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'new-model-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) closeNewModelForm(); };
    document.body.appendChild(m);
  }

  // Подсчёт следующего номера для подсказки артикула на каждое направление
  const articleHint = directions.length > 0 ? directions[0].code || '' : '';

  let dirOptions = directions.map(d =>
    '<option value="' + d.id + '">' + escapeHtml(d.name) + '</option>'
  ).join('');

  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:520px;max-height:90vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-package-plus"></i> Новая модель</h3>' +
        '<button class="modal-close" onclick="closeNewModelForm()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:18px;overflow-y:auto;flex:1;">' +
        // Направление
        '<label style="display:block;margin-bottom:6px;font-size:13px;color:var(--text-light);font-weight:500;">Направление *</label>' +
        '<select id="nm-direction" onchange="onNewModelDirectionChange()" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:14px;background:white;font-family:inherit;">' +
          dirOptions +
        '</select>' +
        // Подгруппа (если у выбранного направления есть подгруппы)
        '<div id="nm-subgroup-wrap" style="display:none;">' +
          '<label style="display:block;margin-bottom:6px;font-size:13px;color:var(--text-light);font-weight:500;">Подгруппа <span style="color:var(--text-light);font-weight:400;">(необязательно)</span></label>' +
          '<select id="nm-subgroup" onchange="onNewModelSubgroupChange()" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:14px;background:white;font-family:inherit;">' +
            '<option value="">— Без подгруппы —</option>' +
          '</select>' +
        '</div>' +
        // v2.45.85: Категория (внутри направления, опционально привязана к подгруппе)
        '<div id="nm-category-wrap" style="display:none;">' +
          '<label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:13px;color:var(--text-light);font-weight:500;">' +
            '<span style="flex:1;">Категория <span style="color:var(--text-light);font-weight:400;">(напр. «Балка монтажная»)</span></span>' +
            '<button type="button" onclick="_nmCreateCategoryInline()" style="background:none;border:none;color:var(--brand);font-size:11.5px;cursor:pointer;font-weight:600;padding:0;">+ Новая</button>' +
          '</label>' +
          '<select id="nm-category" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:14px;background:white;font-family:inherit;">' +
            '<option value="">— Без категории —</option>' +
          '</select>' +
        '</div>' +
        // Название
        '<label style="display:block;margin-bottom:6px;font-size:13px;color:var(--text-light);font-weight:500;">Название модели *</label>' +
        '<input type="text" id="nm-name" placeholder="Например: Наружный блок №49" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:14px;" />' +
        // Артикул
        '<label style="display:block;margin-bottom:6px;font-size:13px;color:var(--text-light);font-weight:500;">Артикул * <span style="color:var(--text-light);font-weight:400;">(уникальный код)</span></label>' +
        '<input type="text" id="nm-article" placeholder="Например: КЛМ-НБ-049" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:14px;font-family:monospace;text-transform:uppercase;" />' +
        // Доп. описание
        '<label style="display:block;margin-bottom:6px;font-size:13px;color:var(--text-light);font-weight:500;">Дополнительно <span style="color:var(--text-light);font-weight:400;">(необязательно — IP54, нерж, габариты, и т.д.)</span></label>' +
        '<input type="text" id="nm-extra" placeholder="Например: 600×800×200, IP65" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:14px;" />' +
        // Опции
        '<div style="background:var(--bg);border-radius:8px;padding:12px 14px;margin-bottom:14px;">' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer;margin-bottom:10px;">' +
            '<input type="checkbox" id="nm-needs-ip" />' +
            '<span>Требуется указать IP при сборке (IP54, IP65 и т.д.)</span>' +
          '</label>' +
          '<label style="display:block;margin-bottom:6px;font-size:13px;color:var(--text-light);">Исполнение</label>' +
          '<select id="nm-exec-mode" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:white;font-family:inherit;">' +
            '<option value="none">Без выбора</option>' +
            '<option value="choice">Мастер выбирает: Стандарт / Нерж. AISI</option>' +
            '<option value="fixed">Фиксированное</option>' +
          '</select>' +
          '<input type="text" id="nm-exec-fixed" placeholder="Какое исполнение? (например: Нерж. AISI 304)" style="display:none;width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-top:8px;" />' +
        '</div>' +
        // Тип работы
        '<label style="display:block;margin-bottom:6px;font-size:13px;color:var(--text-light);font-weight:500;">Тип работы</label>' +
        '<select id="nm-work-type" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:white;font-family:inherit;">' +
          '<option value="full_build">Полная сборка из материалов</option>' +
          '<option value="modify_purchased">Модификация покупного товара</option>' +
        '</select>' +
      '</div>' +
      '<div style="padding:14px 18px;border-top:1px solid var(--border);background:var(--bg);">' +
        '<button class="btn btn-primary" onclick="submitNewModel()" style="width:100%;">' +
          '<i class="ti ti-check"></i> Создать модель</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');

  // Реактивность поля exec_fixed
  setTimeout(() => {
    const sel = document.getElementById('nm-exec-mode');
    const fix = document.getElementById('nm-exec-fixed');
    if (sel && fix) {
      sel.addEventListener('change', () => {
        fix.style.display = (sel.value === 'fixed') ? '' : 'none';
      });
    }
    // ЭТАП 31.7: инициализация подгрупп для выбранного направления
    onNewModelDirectionChange();
    // фокус на название
    const nameInput = document.getElementById('nm-name');
    if (nameInput) nameInput.focus();
  }, 50);
}

// ЭТАП 31.7: обновление списка подгрупп при смене направления
function onNewModelDirectionChange() {
  const dirSel = document.getElementById('nm-direction');
  const sgWrap = document.getElementById('nm-subgroup-wrap');
  const sgSel = document.getElementById('nm-subgroup');
  if (!dirSel || !sgWrap || !sgSel) return;
  const dirId = parseInt(dirSel.value);
  const directions = (cache.models && cache.models.directions) || [];
  const dir = directions.find(d => d.id === dirId);
  const subgroups = (dir && dir.subgroups) || [];
  if (subgroups.length === 0) {
    sgWrap.style.display = 'none';
    sgSel.innerHTML = '<option value="">— Без подгруппы —</option>';
  } else {
    sgWrap.style.display = '';
    let opts = '<option value="">— Без подгруппы —</option>';
    subgroups.forEach(sg => {
      opts += '<option value="' + sg.id + '">' + escapeHtml(sg.name) + '</option>';
    });
    sgSel.innerHTML = opts;
  }
  // v2.45.85: после смены направления — обновим категории
  onNewModelSubgroupChange();
}

// v2.45.85: обновление списка категорий при смене направления/подгруппы.
// Показываем только категории, привязанные к выбранной подгруппе через
// parent_subgroup_id. Если подгруппа не выбрана — показываем категории
// направления без parent_subgroup_id (плюс «привязки нет»).
function onNewModelSubgroupChange() {
  const dirSel = document.getElementById('nm-direction');
  const sgSel  = document.getElementById('nm-subgroup');
  const catWrap = document.getElementById('nm-category-wrap');
  const catSel  = document.getElementById('nm-category');
  if (!dirSel || !catWrap || !catSel) return;
  const dirId = parseInt(dirSel.value);
  const sgId  = sgSel && sgSel.value ? parseInt(sgSel.value) : null;
  const allCats = (cache.models && cache.models.categories) || [];
  const dirCats = allCats.filter(c => c.direction_id === dirId);
  let cats;
  if (sgId) {
    // v2.45.197: показываем категории, привязанные к этой подгруппе, ПЛЮС
    // непривязанные (parent_subgroup_id пустой) — это легаси-категории вроде
    // «ЩУ-004.000 Приточно-вытяжная вентиляция», которые иначе не выбрать.
    cats = dirCats.filter(c => c.parent_subgroup_id === sgId || !c.parent_subgroup_id);
  } else {
    cats = dirCats.filter(c => !c.parent_subgroup_id);
  }
  if (!dirCats.length) {
    catWrap.style.display = 'none';
    catSel.innerHTML = '<option value="">— Без категории —</option>';
    return;
  }
  catWrap.style.display = '';
  let opts = '<option value="">— Без категории —</option>';
  cats.forEach(c => {
    opts += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
  });
  catSel.innerHTML = opts;
}

// v2.45.85: создать новую категорию прямо из формы «Новая модель»
async function _nmCreateCategoryInline() {
  const dirSel = document.getElementById('nm-direction');
  const sgSel  = document.getElementById('nm-subgroup');
  const dirId = parseInt(dirSel.value);
  const sgId  = sgSel && sgSel.value ? parseInt(sgSel.value) : null;
  const sgName = sgSel && sgSel.value ? (sgSel.options[sgSel.selectedIndex].textContent || '') : '';
  const promptText = sgId
    ? 'Имя новой категории в подгруппе «' + sgName + '»:'
    : 'Имя новой категории направления:';
  const name = prompt(promptText, '');
  if (!name || !name.trim()) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/admin/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        direction_id: dirId,
        subgroup_id: sgId,
        name: name.trim(),
      }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || ('HTTP ' + r.status), 'error');
      return;
    }
    const d = await r.json();
    // Добавляем в кэш категорий
    if (cache.models && cache.models.categories) {
      cache.models.categories.push({
        id: d.id, direction_id: d.direction_id, code: d.code,
        name: d.name, parent_subgroup_id: d.parent_subgroup_id,
      });
    }
    // Обновим селект и выберем новую категорию
    onNewModelSubgroupChange();
    const catSel = document.getElementById('nm-category');
    if (catSel) catSel.value = String(d.id);
    showToast('Категория «' + d.name + '» создана', 'success');
  } catch (e) { showToast('Ошибка', 'error'); }
}

function closeNewModelForm() {
  const m = document.getElementById('new-model-modal');
  if (m) m.classList.remove('visible');
}

async function submitNewModel() {
  const direction_id = parseInt(document.getElementById('nm-direction').value);
  const subgroupRaw = (document.getElementById('nm-subgroup') && document.getElementById('nm-subgroup').value) || '';
  const subgroup_id = subgroupRaw ? parseInt(subgroupRaw) : null;
  // v2.45.85: категория (если выбрана)
  const catRaw = (document.getElementById('nm-category') && document.getElementById('nm-category').value) || '';
  const category_id = catRaw ? parseInt(catRaw) : null;
  const name = (document.getElementById('nm-name').value || '').trim();
  const article = (document.getElementById('nm-article').value || '').trim().toUpperCase();
  const extra = (document.getElementById('nm-extra').value || '').trim();
  const needs_ip = document.getElementById('nm-needs-ip').checked;
  const exec_mode = document.getElementById('nm-exec-mode').value;
  const exec_fixed = (document.getElementById('nm-exec-fixed').value || '').trim();
  const work_type = document.getElementById('nm-work-type').value;

  if (!direction_id) { showToast('Выбери направление', 'error'); return; }
  if (!name) { showToast('Введи название модели', 'error'); return; }
  if (!article) { showToast('Введи артикул', 'error'); return; }
  if (exec_mode === 'fixed' && !exec_fixed) {
    showToast('Укажи какое именно исполнение', 'error'); return;
  }

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        direction_id, subgroup_id, category_id, name, article, extra,
        needs_ip, exec_mode, exec_fixed, work_type,
      }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось создать модель', 'error');
      return;
    }
    showToast('Модель создана', 'success');
    closeNewModelForm();
    cache.models = null;          // сброс кэша
    await loadModels();
    // Раскроем группу новой модели
    const openMap = JSON.parse(localStorage.getItem('models_groups_open') || '{}');
    openMap[direction_id] = true;
    localStorage.setItem('models_groups_open', JSON.stringify(openMap));
    renderModels(cache.models);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// ============ ЭТАП 44: НОВЫЙ РАЗДЕЛ НОМЕНКЛАТУРЫ ============

// Набор иконок для выбора (tabler) — покрывает типичные категории оборудования
const DIR_ICON_PRESETS = [
  'ti-box',
  'ti-adjustments-horizontal',
  'ti-temperature',
  'ti-temperature-snow',
  'ti-snowflake',
  'ti-flame',
  'ti-droplet',
  'ti-air-conditioning',
  'ti-wind',
  'ti-bolt',
  'ti-layout-grid',
  'ti-tool',
];

// Транслитерация для автогенерации кода: первая буква каждого слова
const DIR_CYR2LAT = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e',
  'ж':'zh','з':'z','и':'i','й':'i','к':'k','л':'l','м':'m',
  'н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
  'ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sh',
  'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
};

function _autoGenDirectionCode(name) {
  const s = (name || '').trim().toLowerCase();
  if (!s) return '';
  const words = s.split(/\s+/).filter(Boolean);
  let code = '';
  for (const w of words) {
    const first = w[0] || '';
    code += (DIR_CYR2LAT[first] !== undefined ? DIR_CYR2LAT[first] : (/[a-z0-9]/.test(first) ? first : ''));
    if (code.length >= 4) break;
  }
  code = code.replace(/[^a-z0-9]/g, '');
  if (code.length < 2 && words.length === 1) {
    // Один короткий слов — добавим больше букв
    const w = words[0];
    code = '';
    for (const ch of w) {
      code += (DIR_CYR2LAT[ch] !== undefined ? DIR_CYR2LAT[ch] : (/[a-z0-9]/.test(ch) ? ch : ''));
      if (code.length >= 3) break;
    }
  }
  return code.slice(0, 4);
}

function openNewDirectionForm() {
  if (!canManageSales()) {
    showToast('Создавать разделы может директор или зам', 'error');
    return;
  }
  let m = document.getElementById('new-direction-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'new-direction-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) closeNewDirectionForm(); };
    document.body.appendChild(m);
  }

  const iconsHtml = DIR_ICON_PRESETS.map((ic, idx) =>
    '<button type="button" class="nd-icon-btn' + (idx === 0 ? ' selected' : '') +
    '" data-icon="' + ic + '" onclick="selectDirectionIcon(\'' + ic + '\')" ' +
    'style="display:flex;align-items:center;justify-content:center;width:42px;height:42px;border:1px solid var(--border);border-radius:8px;background:white;cursor:pointer;transition:all .15s;">' +
    '<i class="ti ' + ic + '" style="font-size:20px;color:var(--text-mid);"></i>' +
    '</button>'
  ).join('');

  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:480px;max-height:90vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-folder-plus"></i> Новый раздел номенклатуры</h3>' +
        '<button class="modal-close" onclick="closeNewDirectionForm()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:18px;overflow-y:auto;flex:1;">' +
        // Название
        '<label style="display:block;margin-bottom:6px;font-size:13px;color:var(--text-light);font-weight:500;">Название раздела *</label>' +
        '<input type="text" id="nd-name" oninput="_onNdNameInput()" placeholder="Например: Смесительные узлы" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:14px;" autocomplete="off" />' +
        // Иконка
        '<label style="display:block;margin-bottom:8px;font-size:13px;color:var(--text-light);font-weight:500;">Иконка</label>' +
        '<div id="nd-icons" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">' +
          iconsHtml +
        '</div>' +
        '<input type="hidden" id="nd-icon" value="' + DIR_ICON_PRESETS[0] + '" />' +
        // Доп. блок
        '<details style="margin-bottom:4px;">' +
          '<summary style="cursor:pointer;font-size:13px;color:var(--text-mid);font-weight:500;margin-bottom:10px;user-select:none;"><i class="ti ti-chevron-down" style="font-size:14px;vertical-align:middle;"></i> Дополнительно</summary>' +
          '<div style="padding-top:6px;">' +
            '<label style="display:block;margin-bottom:6px;font-size:13px;color:var(--text-light);font-weight:500;">Описание <span style="color:var(--text-light);font-weight:400;">(необязательно)</span></label>' +
            '<input type="text" id="nd-subtitle" placeholder="Например: узлы регулирования температуры" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:14px;" autocomplete="off" />' +
            '<label style="display:block;margin-bottom:6px;font-size:13px;color:var(--text-light);font-weight:500;">Короткий код <span style="color:var(--text-light);font-weight:400;">(автоматически из названия)</span></label>' +
            '<input type="text" id="nd-code" placeholder="Например: smu" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:6px;font-family:monospace;" autocomplete="off" maxlength="12" />' +
            '<div style="font-size:11px;color:var(--text-light);">latin/цифры/дефис, 2–12 символов</div>' +
          '</div>' +
        '</details>' +
        '<div style="margin-top:14px;padding:10px 12px;background:#eef2ff;border-radius:8px;color:#3730a3;font-size:12px;display:flex;align-items:center;gap:8px;">' +
          '<i class="ti ti-info-circle" style="font-size:16px;"></i>' +
          '<span>Раздел появится в выпадашках Производства и в боте после создания модели.</span>' +
        '</div>' +
      '</div>' +
      '<div style="padding:14px 18px;border-top:1px solid var(--border);background:var(--bg);display:flex;gap:10px;">' +
        '<button class="btn btn-secondary" onclick="closeNewDirectionForm()" style="flex:1;">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitNewDirection()" style="flex:2;">' +
          '<i class="ti ti-check"></i> Создать раздел</button>' +
      '</div>' +
    '</div>';

  // CSS для выбора иконки (один раз)
  if (!document.getElementById('nd-icon-style')) {
    const s = document.createElement('style');
    s.id = 'nd-icon-style';
    s.textContent =
      '.nd-icon-btn:hover { background:var(--bg) !important; border-color:var(--brand) !important; }' +
      '.nd-icon-btn.selected { background:var(--brand) !important; border-color:var(--brand) !important; }' +
      '.nd-icon-btn.selected i { color:white !important; }';
    document.head.appendChild(s);
  }

  m.classList.add('visible');
  setTimeout(() => {
    const nameInput = document.getElementById('nd-name');
    if (nameInput) nameInput.focus();
  }, 50);
}

function _onNdNameInput() {
  const nameEl = document.getElementById('nd-name');
  const codeEl = document.getElementById('nd-code');
  if (!nameEl || !codeEl) return;
  // Если код пустой или авто-сгенерирован — обновляем
  if (!codeEl.dataset.manual) {
    codeEl.value = _autoGenDirectionCode(nameEl.value);
  }
  // Помечаем код как ручной если пользователь сам его правил
  codeEl.oninput = () => { codeEl.dataset.manual = '1'; };
}

function selectDirectionIcon(icon) {
  const hidden = document.getElementById('nd-icon');
  if (hidden) hidden.value = icon;
  document.querySelectorAll('.nd-icon-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.icon === icon);
  });
}

function closeNewDirectionForm() {
  const m = document.getElementById('new-direction-modal');
  if (m) m.classList.remove('visible');
}

async function submitNewDirection() {
  const name = (document.getElementById('nd-name').value || '').trim();
  const code = (document.getElementById('nd-code').value || '').trim().toLowerCase();
  const subtitle = (document.getElementById('nd-subtitle').value || '').trim();
  const icon = (document.getElementById('nd-icon').value || '').trim();

  if (!name) { showToast('Введи название раздела', 'error'); return; }

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/directions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        name: name,
        code: code || undefined,   // бэк сгенерит сам если пусто
        subtitle: subtitle || undefined,
        icon: icon || undefined,
      }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось создать раздел', 'error');
      return;
    }
    const created = await r.json();
    showToast('Раздел «' + (created.name || name) + '» создан', 'success');
    closeNewDirectionForm();
    cache.models = null;          // сброс кэша
    await loadModels();
    // Раскроем новый раздел сразу (он пустой)
    if (created.id) {
      const openMap = JSON.parse(localStorage.getItem('models_groups_open') || '{}');
      openMap[created.id] = true;
      localStorage.setItem('models_groups_open', JSON.stringify(openMap));
      renderModels(cache.models);
    }
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// ============ НОВАЯ СБОРКА ============

function openNewAssembly() {
  if (!canCreateAssembly()) {
    showToast('Внесение сборок доступно только мастерам и директору.', 'error'); return;
  }
  selectSidebarItem('new-assembly');
}

function cancelNewAssembly() {
  selectSidebarItem('dashboard');
}

function initNewAssemblyForm() {
  state.newAssembly = {
    model: null, execution: null, ipClass: null,
    quantity: 1, workerIds: [], dateMode: 'today', customDate: null, comment: '',
    contractId: null,            // ЭТАП 15: ID договора (NULL = на склад)
    contractLabel: '',           // короткое описание для UI: «№12-Д · ООО Иванов»
    // ЭТАП 23: универсальные работы
    workType: 'assembly',        // assembly | repair | commissioning | installation | diagnostics | design | maintenance | other
    description: '',             // что было сделано (для не-сборок)
    location: '',                // адрес/объект
    hours_spent: null,           // часы
    initialStatus: 'in_progress', // v2.42.2 / v2.43.14: дефолт «в работе сейчас»
  };
  // алиас для inline-обработчиков
  state.newAssemblyForm = state.newAssembly;
  if (typeof setAssemblyStatusToggle === 'function') setAssemblyStatusToggle('in_progress');
  document.getElementById('submit-error').textContent = '';
  document.getElementById('qty-input').value = 1;
  document.getElementById('comment-input').value = '';
  document.getElementById('comment-counter-text').textContent = '0';
  document.getElementById('date-input-wrap').classList.remove('visible');
  document.getElementById('date-input').value = '';
  document.getElementById('execution-section').style.display = 'none';
  document.getElementById('ip-section').style.display = 'none';

  document.getElementById('selected-model-display').innerHTML =
    '<div class="placeholder">Выберите модель…</div>';
  // Сбросить выбор «договор/склад»
  const dest = document.getElementById('na-destination-display');
  if (dest) renderAssemblyDestination();

  document.querySelectorAll('#ip-section .chip-option').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.date-row .chip-option').forEach(c => c.classList.remove('selected'));
  document.querySelector('.date-row .chip-option[data-date="today"]').classList.add('selected');

  // ЭТАП 23: сброс типа работы на «Сборка»
  setWorkType('assembly');
  const naDesc = document.getElementById('na-description'); if (naDesc) naDesc.value = '';
  const naLoc  = document.getElementById('na-location');    if (naLoc)  naLoc.value = '';
  const naHrs  = document.getElementById('na-hours');       if (naHrs)  naHrs.value = '';

  ensureModelsLoaded();
  loadActiveEmployees();

  // v2.19.0: предзаполнение из виджета «На сборку» (takeForAssembly)
  _applyAssemblyPrefillIfAny();
}

// v2.19.0: подхватываем prefill из state._prefillAssembly (если был takeForAssembly)
async function _applyAssemblyPrefillIfAny() {
  if (!state._prefillAssembly) return;
  const pf = state._prefillAssembly;
  state._prefillAssembly = null;  // одноразово
  try {
    // Подтягиваем модели если ещё не загружены
    if (!cache.models) {
      try { await ensureModelsLoaded(); } catch (e) {}
    }
    // 1. Модель — если есть в кэше
    if (pf.model_id && cache.models && cache.models.models) {
      const model = cache.models.models.find(m => m.id === pf.model_id);
      if (model) {
        selectModel(pf.model_id);
        // 2. Исполнение
        if (pf.execution) {
          setTimeout(() => {
            const chip = document.querySelector('#execution-chips .chip-option[data-exec="' + pf.execution + '"]');
            if (chip) chip.click();
          }, 50);
        }
        // 3. IP-класс
        if (pf.ip_class) {
          setTimeout(() => {
            const chip = document.querySelector('#ip-section .chip-option[data-ip="' + pf.ip_class + '"]');
            if (chip) chip.click();
          }, 70);
        }
      }
    }
    // 4. Договор
    if (pf.contract_id) {
      try {
        const c = await apiGet('/api/contracts/' + pf.contract_id);
        state.newAssembly.contractId = c.id;
        state.newAssembly.contractLabel = '№' + (c.number || '') + (c.contractor_name ? ' · ' + c.contractor_name : '');
        if (typeof renderAssemblyDestination === 'function') renderAssemblyDestination();
      } catch (e) {
        // не критично
      }
    }
    showToast('Форма предзаполнена. Укажите сборщиков и сохраните.', 'info');
  } catch (e) {
    // тихо
  }
}

// ЭТАП 23: переключение типа работы
function setWorkType(wt) {
  if (!state.newAssembly) return;
  state.newAssembly.workType = wt;
  state.newAssemblyForm = state.newAssembly;
  // Подсветка таблеток
  document.querySelectorAll('.work-type-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.wt === wt);
  });
  const isAssembly = (wt === 'assembly');
  // Показ/скрытие секций
  const modelSec   = document.getElementById('model-section');
  const descSec    = document.getElementById('work-description-section');
  const locSec     = document.getElementById('work-location-section');
  const hoursSec   = document.getElementById('work-hours-section');
  const execSec    = document.getElementById('execution-section');
  const ipSec      = document.getElementById('ip-section');
  const qtySec     = document.getElementById('quantity-section');
  if (modelSec) modelSec.style.display = isAssembly ? '' : 'none';
  if (descSec)  descSec.style.display  = isAssembly ? 'none' : '';
  if (locSec)   locSec.style.display   = isAssembly ? 'none' : '';
  if (hoursSec) hoursSec.style.display = isAssembly ? 'none' : '';
  if (qtySec)   qtySec.style.display   = isAssembly ? '' : 'none';
  // Для не-сборок прячем исполнение/IP даже если ранее выбраны
  if (!isAssembly) {
    if (execSec) execSec.style.display = 'none';
    if (ipSec)   ipSec.style.display   = 'none';
    // Количество всегда 1 для услуги
    state.newAssembly.quantity = 1;
    const qtyInp = document.getElementById('qty-input');
    if (qtyInp) qtyInp.value = 1;
  }
  // Назначение: «Куда идёт сборка» — для сборки. Для работ — упрощённый «Без привязки / По договору»
  const destLabel  = document.getElementById('destination-label');
  const destChoice = document.getElementById('destination-choice');
  const destChoiceW = document.getElementById('destination-choice-work');
  if (destLabel)  destLabel.textContent = isAssembly ? 'Куда идёт сборка' : 'Привязка к договору';
  if (destChoice)  destChoice.style.display  = isAssembly ? '' : 'none';
  if (destChoiceW) destChoiceW.style.display = isAssembly ? 'none' : '';

  // Лейбл «Кто собирал» / «Кто делал» / «Исполнители»
  const workersLabel = document.getElementById('workers-label-text');
  const dateLabel    = document.getElementById('date-label-text');
  if (workersLabel) workersLabel.textContent = isAssembly ? 'Кто собирал' : 'Кто делал';
  if (dateLabel)    dateLabel.textContent    = isAssembly ? 'Дата сборки' : 'Дата работы';

  // Заголовки h1 и h2 на экране — у них нет id, ставим напрямую
  const titles = {
    assembly: 'Новая сборка', repair: 'Новый ремонт',
    commissioning: 'Новая пусконаладка', installation: 'Новый монтаж',
    diagnostics: 'Новая диагностика', design: 'Новое проектирование',
    maintenance: 'Новое ТО', other: 'Новая работа',
  };
  const title = titles[wt] || 'Новая работа';
  document.querySelectorAll('[data-screen="new-assembly"] .screen-header h2, [data-screen="new-assembly"] .page-header h1').forEach(h => {
    h.textContent = title;
  });
  // Кнопка отправки текст
  const submitBtn = document.querySelector('[data-screen="new-assembly"] .btn-primary');
  if (submitBtn) submitBtn.innerHTML = '<i class="ti ti-check"></i> Сохранить';
}

// Привязка работы к договору (упрощённо — «Без привязки» / «По договору»)
function setWorkContract(contractId) {
  if (!state.newAssembly) return;
  state.newAssembly.contractId = contractId || null;
  document.querySelectorAll('#destination-choice-work .dest-option').forEach(b => b.classList.remove('selected'));
  if (contractId) {
    const btn = document.querySelector('#destination-choice-work .dest-option[data-dest-w="contract"]');
    if (btn) btn.classList.add('selected');
  } else {
    const btn = document.querySelector('#destination-choice-work .dest-option[data-dest-w="none"]');
    if (btn) btn.classList.add('selected');
    const meta = document.getElementById('na-work-contract-meta');
    if (meta) meta.textContent = 'Выбрать договор';
  }
}

// Открыть подбор договора (переиспользуем модалку «Под договор» обычной сборки)
async function openContractPickerForWork() {
  // Делегируем существующей функции подбора договора (она устанавливает state.newAssembly.contractId)
  try {
    if (typeof openContractPicker === 'function') {
      openContractPicker((c) => {
        if (c && c.id) {
          state.newAssembly.contractId = c.id;
          state.newAssembly.contractLabel = (c.number || '') + (c.contractor_name ? ' · ' + c.contractor_name : '');
          // Подсветим вариант
          document.querySelectorAll('#destination-choice-work .dest-option').forEach(b => b.classList.remove('selected'));
          const btn = document.querySelector('#destination-choice-work .dest-option[data-dest-w="contract"]');
          if (btn) btn.classList.add('selected');
          const meta = document.getElementById('na-work-contract-meta');
          if (meta) meta.textContent = state.newAssembly.contractLabel;
        }
      });
    } else {
      // Fallback: вызовем существующий обработчик "Под договор" из обычной сборки
      setAssemblyDestination('contract');
    }
  } catch (e) {
    showToast('Не удалось открыть выбор договора', 'error');
  }
}

async function ensureModelsLoaded() {
  if (cache.models) return;
  try { cache.models = await apiGet('/api/models'); } catch (e) {}
}

async function loadActiveEmployees() {
  const container = document.getElementById('workers-list');
  if (cache.activeEmployees) { renderWorkersList(cache.activeEmployees); return; }
  container.innerHTML = '<div class="loading-block">Загружаем список…</div>';
  try {
    const d = await apiGet('/api/employees/active');
    cache.activeEmployees = d;
    renderWorkersList(d);
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>' + escapeHtml(String(e)) + '</div>';
  }
}

function renderWorkersList(d) {
  // v2.7.5: вместо открытого списка — компактная плашка-пикер.
  // Сам выбор делается в модалке #workers-modal.
  const container = document.getElementById('workers-list');
  if (!container) return;

  if (!d || !d.employees || d.employees.length === 0) {
    container.innerHTML = '<div class="empty-block">Активных сотрудников нет</div>';
    return;
  }

  const all = d.employees;
  const selectedIds = (state.newAssembly && state.newAssembly.workerIds) || [];
  const selected = all.filter(e => selectedIds.indexOf(e.id) >= 0);

  let html = '';
  if (selected.length === 0) {
    // Пусто — большая кнопка-плашка
    html =
      '<button type="button" class="workers-picker-empty" onclick="openWorkersModal()">' +
        '<span class="wpe-left"><i class="ti ti-users"></i> Выбрать сотрудников</span>' +
        '<i class="ti ti-chevron-right wpe-chev"></i>' +
      '</button>';
  } else {
    // Выбраны — picker-display со списком чипов
    const MAX_CHIPS = 5;
    const shown = selected.slice(0, MAX_CHIPS);
    const more = selected.length - shown.length;

    let chips = '';
    shown.forEach(emp => {
      const name = emp.short_name || emp.full_name || '—';
      chips += '<span class="wps-chip">' +
                 (emp.is_master ? '<i class="ti ti-tool"></i>' : '<i class="ti ti-user"></i>') +
                 escapeHtml(name) +
               '</span>';
    });
    if (more > 0) {
      chips += '<span class="wps-more">+ ещё ' + more + '</span>';
    }

    html =
      '<div class="picker-display workers-picker-selected" onclick="openWorkersModal()" style="cursor:pointer;">' +
        '<div class="picker-display-value" style="flex:1; white-space:normal; overflow:visible;">' +
          '<div class="wps-chips">' + chips + '</div>' +
        '</div>' +
        '<div class="picker-display-actions" onclick="event.stopPropagation();">' +
          '<button type="button" class="btn-link" onclick="openWorkersModal()">Изменить</button>' +
          '<button type="button" class="btn-link btn-link-danger" onclick="clearWorkersSelection()">Очистить</button>' +
        '</div>' +
      '</div>';
  }
  container.innerHTML = html;
}

// v2.7.5: открыть модалку выбора сотрудников
function openWorkersModal() {
  const ov = document.getElementById('workers-modal');
  if (!ov) return;
  ov.classList.add('visible');
  const si = document.getElementById('workers-modal-search');
  if (si) si.value = '';
  renderWorkersInModal('');
  updateWorkersModalCount();
  // На десктопе — автофокус в поиск, на мобиле — нет (иначе клавиатура мешает)
  setTimeout(() => {
    if (si && window.innerWidth > 700) si.focus();
  }, 100);
}

function closeWorkersModal() {
  const ov = document.getElementById('workers-modal');
  if (ov) ov.classList.remove('visible');
}

function onWorkersModalSearch(query) {
  renderWorkersInModal(query || '');
}

function renderWorkersInModal(query) {
  const body = document.getElementById('workers-modal-body');
  if (!body) return;

  // Источник данных — тот же кэш. cache.activeEmployees от loadActiveEmployees
  // приходит как объект {employees:[...]}, но в др. местах кода — как массив.
  // Поддерживаем оба варианта на всякий случай.
  let employees = null;
  if (cache.activeEmployees) {
    if (Array.isArray(cache.activeEmployees)) employees = cache.activeEmployees;
    else if (cache.activeEmployees.employees) employees = cache.activeEmployees.employees;
  }
  if (!employees) {
    body.innerHTML = '<div class="loading-block">Загружаем…</div>';
    apiGet('/api/employees/active').then(d => {
      cache.activeEmployees = d;
      renderWorkersInModal(query);
    }).catch(e => {
      body.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>' + escapeHtml(String(e)) + '</div>';
    });
    return;
  }

  let list = employees.filter(e => e.is_active !== false);

  // ЭТАП 31.5: показываем только производственный персонал — мастер/сборщик/инженер.
  // Маркер 1 — должность (поле position) содержит ключевое слово.
  // Маркер 2 — флаг is_master (на всякий случай оставляем мастеров даже если должность странная).
  const PROD_KEYWORDS = ['мастер', 'сборщик', 'инженер'];
  list = list.filter(e => {
    if (e.is_master) return true;
    const pos = String(e.position || '').toLowerCase();
    if (!pos) return false;
    return PROD_KEYWORDS.some(k => pos.indexOf(k) >= 0);
  });

  const q = (query || '').trim().toLowerCase();
  if (q) {
    list = list.filter(e => {
      const a = (e.short_name || '').toLowerCase();
      const b = (e.full_name || '').toLowerCase();
      return a.indexOf(q) >= 0 || b.indexOf(q) >= 0;
    });
  }
  // Сортировка: сначала мастера, потом алфавит
  list.sort((a, b) => {
    if (a.is_master !== b.is_master) return (b.is_master ? 1 : 0) - (a.is_master ? 1 : 0);
    return (a.short_name || a.full_name || '').localeCompare(b.short_name || b.full_name || '');
  });

  if (!list.length) {
    body.innerHTML = '<div class="empty-block">Никого не найдено</div>';
    return;
  }

  const selectedIds = (state.newAssembly && state.newAssembly.workerIds) || [];
  let html = '';
  list.forEach(emp => {
    const name = emp.short_name || emp.full_name || '—';
    const isSel = selectedIds.indexOf(emp.id) >= 0;
    const masterCls = emp.is_master ? ' master-row' : '';
    html += '<div class="worker-row' + masterCls + (isSel ? ' selected' : '') + '" data-wid="' + emp.id + '">' +
      '<div class="check"><i class="ti ti-check"></i></div>' +
      '<div class="w-name">' + escapeHtml(name) + '</div>' +
      (emp.is_master ? '<span class="w-badge">мастер</span>' : '') +
      '</div>';
  });
  body.innerHTML = html;
  body.querySelectorAll('.worker-row').forEach(row => {
    row.addEventListener('click', () => toggleWorker(parseInt(row.dataset.wid), row));
  });
}

function updateWorkersModalCount() {
  const el = document.getElementById('workers-modal-count');
  if (!el) return;
  const n = ((state.newAssembly && state.newAssembly.workerIds) || []).length;
  el.textContent = 'Выбрано: ' + n;
}

function clearWorkersSelection() {
  if (!state.newAssembly) return;
  state.newAssembly.workerIds = [];
  // Обновим модалку (если открыта) и плашку
  const ov = document.getElementById('workers-modal');
  if (ov && ov.classList.contains('visible')) {
    const si = document.getElementById('workers-modal-search');
    renderWorkersInModal(si ? si.value : '');
  }
  updateWorkersModalCount();
  if (cache.activeEmployees) {
    const d = cache.activeEmployees.employees ? cache.activeEmployees : { employees: cache.activeEmployees };
    renderWorkersList(d);
  }
}

function toggleWorker(wid, row) {
  // v2.7.5: row может быть из модалки. Сохраняем контракт с старым кодом
  // (где row передавался из открытого списка) — просто обновляем класс если row есть.
  if (!state.newAssembly) return;
  const idx = state.newAssembly.workerIds.indexOf(wid);
  if (idx >= 0) {
    state.newAssembly.workerIds.splice(idx, 1);
    if (row) row.classList.remove('selected');
  } else {
    state.newAssembly.workerIds.push(wid);
    if (row) row.classList.add('selected');
  }
  // Обновим счётчик в футере модалки и плашку под формой
  updateWorkersModalCount();
  if (cache.activeEmployees) {
    const d = cache.activeEmployees.employees ? cache.activeEmployees : { employees: cache.activeEmployees };
    renderWorkersList(d);
  }
}

function openModelModal() {
  document.getElementById('model-modal').classList.add('visible');
  document.getElementById('model-search').value = '';
  renderModelModalList('');
  setTimeout(() => document.getElementById('model-search').focus(), 100);
}

function closeModelModal() {
  document.getElementById('model-modal').classList.remove('visible');
}

function renderModelModalList(query) {
  const container = document.getElementById('model-modal-body');
  if (!cache.models) {
    container.innerHTML = '<div class="loading-block">Загружаем…</div>';
    apiGet('/api/models').then(d => { cache.models = d; renderModelModalList(query); });
    return;
  }
  const all = cache.models.models.filter(m => m.is_active);
  const dirMap = {};
  cache.models.directions.forEach(d => { dirMap[d.id] = d; });

  let filtered = all;
  if (query) {
    filtered = all.filter(m => {
      const title = (m.name + ' ' + (m.extra || '') + ' ' + (m.article || '')).toLowerCase();
      return title.includes(query);
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-search"></i>Ничего не найдено</div>';
    return;
  }

  // Группируем по направлениям, затем внутри — по подгруппам
  const groups = {};
  filtered.forEach(m => {
    const dirId = m.direction_id || 0;
    if (!groups[dirId]) groups[dirId] = { withoutSub: [], bySub: {} };
    if (m.subgroup_id) {
      const sid = String(m.subgroup_id);
      if (!groups[dirId].bySub[sid]) {
        groups[dirId].bySub[sid] = { name: m.subgroup_name || ('Подгруппа #' + sid), items: [] };
      }
      groups[dirId].bySub[sid].items.push(m);
    } else {
      groups[dirId].withoutSub.push(m);
    }
  });

  // v2.42.0: при поиске — автоматически раскрываем всё. Без поиска — используем сохранённое состояние.
  const openMap = JSON.parse(localStorage.getItem('modelpicker_groups_open') || '{}');
  const openSubMap = JSON.parse(localStorage.getItem('modelpicker_subgroups_open') || '{}');
  const dirIds = Object.keys(groups).sort((a, b) => Number(a) - Number(b));
  const hasQuery = !!query;
  const defaultOpen = hasQuery || (dirIds.length === 1);

  let html = '';
  dirIds.forEach(dirId => {
    const dir = dirMap[dirId];
    const dirName = dir ? dir.name : '—';
    const dirNamePretty = (typeof _nvCapitalize === 'function') ? _nvCapitalize(dirName) : dirName;
    const palCls = (typeof _nvPaletteClass === 'function') ? _nvPaletteClass(dir ? (dir.code || dir.name) : dirId) : '';
    const iconCls = (typeof _nvIconFor === 'function') ? _nvIconFor(dirName) : (typeof getDirectionIcon === 'function' ? getDirectionIcon(dir ? dir.code : '') : 'ti-folder');
    const g = groups[dirId];
    const totalCount = g.withoutSub.length + Object.values(g.bySub).reduce((s, x) => s + x.items.length, 0);
    const isOpen = hasQuery ? true : ((dirId in openMap) ? !!openMap[dirId] : defaultOpen);
    const subKeys = Object.keys(g.bySub).sort((a, b) => (g.bySub[a].name || '').localeCompare(g.bySub[b].name || ''));

    html += '<button class="modelpicker-group-toggle ' + palCls + '" data-dirid="' + dirId + '" onclick="toggleModelPickerGroup(\'' + dirId + '\')">' +
      '<i class="ti ti-chevron-right mp-chevron' + (isOpen ? ' open' : '') + '"></i>' +
      '<span class="nv-group-icon"><i class="ti ' + iconCls + '"></i></span>' +
      '<span class="mp-name">' + escapeHtml(dirNamePretty) + '</span>' +
      '<span class="mp-count">' + totalCount + '</span>' +
    '</button>';
    html += '<div class="modelpicker-group-body" data-dirid="' + dirId + '" style="' + (isOpen ? '' : 'display:none;') + '">';

    // Модели без подгруппы (только если нет подгрупп — иначе будут торчать)
    if (g.withoutSub.length && !subKeys.length) {
      g.withoutSub.forEach(m => { html += _mpRenderItem(m, iconCls); });
    } else if (g.withoutSub.length) {
      const subKey = dirId + ':none';
      const subOpen = hasQuery || (subKey in openSubMap ? !!openSubMap[subKey] : true);
      html += '<div class="models-subgroup" style="margin-left:8px;">' +
        '<button class="models-subgroup-toggle" data-subkey="' + subKey + '" onclick="toggleModelPickerSubgroup(\'' + subKey + '\')">' +
          '<i class="ti ti-chevron-right models-subgroup-chevron' + (subOpen ? ' open' : '') + '"></i>' +
          '<i class="ti ti-folder sg-icon"></i>' +
          '<span class="sg-name">Без подгруппы</span>' +
          '<span class="models-subgroup-count">' + g.withoutSub.length + '</span>' +
        '</button>' +
        '<div class="models-subgroup-body" data-subkey="' + subKey + '" style="' + (subOpen ? '' : 'display:none;') + '">';
      g.withoutSub.forEach(m => { html += _mpRenderItem(m, iconCls); });
      html += '</div></div>';
    }

    // Подгруппы с темами
    subKeys.forEach(sid => {
      const sg = g.bySub[sid];
      const subKey = dirId + ':' + sid;
      const subOpen = hasQuery || (subKey in openSubMap ? !!openSubMap[subKey] : false);
      const theme = (typeof _subgroupTheme === 'function') ? _subgroupTheme(sg.name) : { icon: 'ti-folder', cls: 'sg-default' };
      html += '<div class="models-subgroup ' + theme.cls + '" style="margin-left:8px;">' +
        '<button class="models-subgroup-toggle" data-subkey="' + subKey + '" onclick="toggleModelPickerSubgroup(\'' + subKey + '\')">' +
          '<i class="ti ti-chevron-right models-subgroup-chevron' + (subOpen ? ' open' : '') + '"></i>' +
          '<i class="ti ' + theme.icon + ' sg-icon"></i>' +
          '<span class="sg-name">' + escapeHtml(sg.name) + '</span>' +
          '<span class="models-subgroup-count">' + sg.items.length + '</span>' +
        '</button>' +
        '<div class="models-subgroup-body" data-subkey="' + subKey + '" style="' + (subOpen ? '' : 'display:none;') + '">';
      sg.items.forEach(m => { html += _mpRenderItem(m, theme.icon); });
      html += '</div></div>';
    });

    html += '</div>';
  });
  container.innerHTML = html;
  container.querySelectorAll('.modal-item').forEach(item => {
    item.addEventListener('click', () => selectModel(parseInt(item.dataset.mid)));
  });
}

// v2.42.0: рендер одной строки модели в пикере с подсветкой AISI
function _mpRenderItem(m, iconCls) {
  const title = m.name + (m.extra ? ' · ' + m.extra : '');
  const meta = [];
  if (m.article) meta.push(m.article);
  if (m.exec_mode === 'choice') meta.push('исполнение: ' + (m.exec_label_st || 'Стандарт') + ' / ' + (m.exec_label_ne || 'Нерж. AISI'));
  else if (m.exec_mode === 'fixed' && m.exec_fixed) meta.push('испол.: ' + m.exec_fixed);
  if (m.needs_ip) meta.push('IP');
  const isAisi = ((m.name || '').toUpperCase().includes('AISI')) || ((m.exec_fixed || '').toLowerCase().startsWith('нерж'));
  const aisiCls = isAisi ? ' mi-aisi' : '';
  const hl = (typeof _highlightAisi === 'function') ? _highlightAisi : escapeHtml;
  return '<div class="modal-item' + aisiCls + '" data-mid="' + m.id + '">' +
    '<div class="mi-icon"><i class="ti ' + iconCls + '"></i></div>' +
    '<div class="mi-text">' +
      '<div class="mi-title">' + hl(title) + '</div>' +
      '<div class="mi-meta">' + hl(meta.join(' · ') || '\u00a0') + '</div>' +
    '</div></div>';
}

function toggleModelPickerSubgroup(subKey) {
  const body = document.querySelector('.models-subgroup-body[data-subkey="' + subKey + '"]');
  const toggle = document.querySelector('.models-subgroup-toggle[data-subkey="' + subKey + '"]');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? '' : 'none';
  if (toggle) {
    const chev = toggle.querySelector('.models-subgroup-chevron');
    if (chev) chev.classList.toggle('open', isHidden);
  }
  const openMap = JSON.parse(localStorage.getItem('modelpicker_subgroups_open') || '{}');
  openMap[subKey] = isHidden;
  localStorage.setItem('modelpicker_subgroups_open', JSON.stringify(openMap));
}

function toggleModelPickerGroup(dirId) {
  const body = document.querySelector('.modelpicker-group-body[data-dirid="' + dirId + '"]');
  const toggle = document.querySelector('.modelpicker-group-toggle[data-dirid="' + dirId + '"]');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? '' : 'none';
  if (toggle) {
    const chev = toggle.querySelector('.mp-chevron');
    if (chev) chev.classList.toggle('open', isHidden);
  }
  const openMap = JSON.parse(localStorage.getItem('modelpicker_groups_open') || '{}');
  openMap[dirId] = isHidden;
  localStorage.setItem('modelpicker_groups_open', JSON.stringify(openMap));
}

function selectModel(modelId) {
  if (!cache.models) return;
  const model = cache.models.models.find(m => m.id === modelId);
  if (!model) return;
  state.newAssembly.model = model;
  state.newAssembly.execution = null;
  state.newAssembly.ipClass = null;

  const title = model.name + (model.extra ? ' · ' + model.extra : '');
  const dirName = (cache.models.directions.find(d => d.id === model.direction_id) || {}).name || '';
  const meta = [];
  if (model.article) meta.push(model.article);
  if (dirName) meta.push(dirName);

  document.getElementById('selected-model-display').innerHTML =
    '<div class="selected-title">' + escapeHtml(title) + '</div>' +
    '<div class="selected-meta">' + escapeHtml(meta.join(' · ')) + '</div>';

  const execSection = document.getElementById('execution-section');
  if (model.exec_mode === 'choice') {
    execSection.style.display = 'block';
    const chips = document.getElementById('execution-chips');
    chips.innerHTML =
      '<button class="chip-option" data-exec="st">' + escapeHtml(model.exec_label_st || 'Стандарт') + '</button>' +
      '<button class="chip-option" data-exec="ne">' + escapeHtml(model.exec_label_ne || 'Нерж. AISI') + '</button>';
    chips.querySelectorAll('.chip-option').forEach(c => {
      c.addEventListener('click', () => {
        chips.querySelectorAll('.chip-option').forEach(x => x.classList.remove('selected'));
        c.classList.add('selected');
        state.newAssembly.execution = c.dataset.exec;
      });
    });
  } else {
    execSection.style.display = 'none';
    state.newAssembly.execution = null;
  }

  const ipSection = document.getElementById('ip-section');
  ipSection.style.display = model.needs_ip ? 'block' : 'none';
  if (!model.needs_ip) state.newAssembly.ipClass = null;
  document.querySelectorAll('#ip-section .chip-option').forEach(c => c.classList.remove('selected'));

  closeModelModal();
  refreshBomPreview();  // ЭТАП 32: предпросмотр списания
}

// ЭТАП 32: предпросмотр автосписания со склада
let _bomPreviewDebounce = null;
function refreshBomPreview() {
  clearTimeout(_bomPreviewDebounce);
  _bomPreviewDebounce = setTimeout(_doBomPreview, 250);
}

async function _doBomPreview() {
  const section = document.getElementById('bom-preview-section');
  const content = document.getElementById('bom-preview-content');
  if (!section || !content) return;

  const model = state.newAssembly && state.newAssembly.model;
  if (!model) { section.style.display = 'none'; return; }
  const qtyInput = document.getElementById('qty-input');
  const quantity = parseInt((qtyInput && qtyInput.value) || 1);
  if (!quantity || quantity < 1) { section.style.display = 'none'; return; }

  try {
    const data = await apiGet('/api/assemblies/preview-writeoff?model_id=' + model.id + '&quantity=' + quantity);
    state._lastBomPreview = data;
    if (!data.items || !data.items.length) {
      section.style.display = 'none';
      return;
    }
    section.style.display = 'block';
    const ok = data.ok_critical;
    let html = '';
    if (!ok) {
      const critMissing = (data.shortage || []).filter(s => s.is_critical);
      html += '<div class="bom-preview-alert"><i class="ti ti-alert-triangle"></i> ' +
        'Не хватает критичных позиций: ' +
        critMissing.map(s => escapeHtml(s.component_name) + ' (' + _fmtQty(s.missing) + ')').join(', ') +
        '. Сборка не будет создана.</div>';
    } else if (data.shortage && data.shortage.length) {
      html += '<div class="bom-preview-warn"><i class="ti ti-info-circle"></i> ' +
        'Некритичных не хватает: ' +
        data.shortage.map(s => escapeHtml(s.component_name)).join(', ') +
        '. Они не будут списаны.</div>';
    }
    html += '<div class="bom-preview-list">';
    data.items.forEach(it => {
      const shortCls = !it.enough ? (it.is_critical ? ' shortage-critical' : ' shortage-warn') : '';
      // Дефицитную складскую позицию (компонент) можно сопоставить вручную —
      // когда авто-матч указал не на ту складскую позицию (дубль/иная привязка).
      const relinkBtn = (it.kind === 'component' && !it.enough && it.bom_id)
        ? '<button class="bom-relink-btn" onclick="openBomRelink(' + it.bom_id + ', ' +
            JSON.stringify(it.component_name || '').replace(/"/g, '&quot;') + ')">' +
            '<i class="ti ti-arrows-exchange"></i> Сопоставить со складом</button>'
        : '';
      html += '<div class="bom-preview-row' + shortCls + '">' +
        '<div class="bom-preview-name">' + escapeHtml(it.component_name) +
          (it.is_critical ? ' <span class="bom-critical" title="Критичное">★</span>' : '') +
          relinkBtn + '</div>' +
        '<div class="bom-preview-qty">' +
          '<b>' + _fmtQty(it.qty_need_total) + '</b> ' + escapeHtml(it.unit_override || it.component_unit || '') +
          '<span class="bom-preview-stock"> (есть ' + _fmtQty(it.qty_have) + ')</span>' +
        '</div></div>';
    });
    html += '</div>';
    content.innerHTML = html;

    // Блокируем кнопку «Сохранить» если не хватает критичных
    const saveBtn = document.querySelector('button[onclick="submitAssembly()"], #submit-assembly-btn, .btn-save-assembly');
    if (saveBtn) {
      if (!ok) {
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.5';
        saveBtn.style.cursor = 'not-allowed';
        saveBtn.title = 'Не хватает критичных комплектующих';
      } else {
        saveBtn.disabled = false;
        saveBtn.style.opacity = '';
        saveBtn.style.cursor = '';
        saveBtn.title = '';
      }
    }
  } catch (e) {
    section.style.display = 'none';
  }
}

// ---- Ручное сопоставление строки спецификации со складской позицией ----
// Когда авто-матч не нашёл остаток (позиция показана «есть 0», хотя на складе
// она есть под другой/дублирующей записью) — даём выбрать нужную вручную.
function openBomRelink(bomId, name) {
  state._bomRelink = { bomId: bomId, name: name || '' };
  let ov = document.getElementById('bom-relink-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'bom-relink-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.onclick = function (e) { if (e.target === ov) closeBomRelink(); };
    document.body.appendChild(ov);
  }
  ov.innerHTML =
    '<div onclick="event.stopPropagation()" style="background:var(--card,#fff);border-radius:14px;max-width:540px;width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;">' +
      '<div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);">' +
        '<h3 style="margin:0;font-size:16px;"><i class="ti ti-arrows-exchange"></i> Сопоставить со складом</h3>' +
        '<button class="modal-close" onclick="closeBomRelink()" style="background:none;border:none;font-size:20px;cursor:pointer;"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:14px 18px;overflow:auto;">' +
        '<div style="font-size:13px;color:var(--text-light);margin-bottom:10px;line-height:1.45;">' +
          'Позиция спецификации: <b>' + escapeHtml(name || '') + '</b>.<br>Выберите складскую позицию, которой она соответствует — спецификация модели будет привязана к ней (повлияет на будущие сборки).' +
        '</div>' +
        '<input id="bom-relink-search" type="text" placeholder="Поиск по названию или артикулу…" ' +
          'oninput="_bomRelinkSearchDebounced(this.value)" ' +
          'style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;box-sizing:border-box;margin-bottom:10px;font-size:14px;">' +
        '<div id="bom-relink-results">Загрузка…</div>' +
      '</div>' +
    '</div>';
  ov.style.display = 'flex';
  _doBomRelinkSearch(name || '');
  setTimeout(function () {
    const i = document.getElementById('bom-relink-search');
    if (i) { i.value = name || ''; i.focus(); i.select(); }
  }, 50);
}

let _bomRelinkDebounce = null;
function _bomRelinkSearchDebounced(q) {
  clearTimeout(_bomRelinkDebounce);
  _bomRelinkDebounce = setTimeout(function () { _doBomRelinkSearch(q); }, 250);
}

async function _doBomRelinkSearch(q) {
  const box = document.getElementById('bom-relink-results');
  if (!box) return;
  try {
    const data = await apiGet('/api/components?search=' + encodeURIComponent(q || ''));
    const comps = (data.components || []).slice(0, 50);
    if (!comps.length) {
      box.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-light);">Ничего не найдено</div>';
      return;
    }
    box.innerHTML = comps.map(function (c) {
      const stock = (c.qty_on_stock !== undefined && c.qty_on_stock !== null) ? c.qty_on_stock : 0;
      const sku = c.sku ? ('<span style="color:var(--text-light);font-size:12px;"> · ' + escapeHtml(c.sku) + '</span>') : '';
      const stockColor = stock > 0 ? '#15803D' : '#B25E00';
      return '<div class="bom-relink-row" onclick="relinkBomComponent(' + c.id + ')" ' +
        'style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;">' +
        '<div><div style="font-weight:600;">' + escapeHtml(c.name || '') + sku + '</div>' +
          (c.category_name ? '<div style="font-size:11.5px;color:var(--text-light);">' + escapeHtml(c.category_name) + '</div>' : '') + '</div>' +
        '<div style="white-space:nowrap;font-weight:700;color:' + stockColor + ';">' + _fmtQty(stock) + ' ' + escapeHtml(c.unit || 'шт.') + '</div>' +
      '</div>';
    }).join('');
  } catch (e) {
    box.innerHTML = '<div style="padding:16px;text-align:center;color:#c0392b;">Ошибка загрузки</div>';
  }
}

async function relinkBomComponent(componentId) {
  const st = state._bomRelink || {};
  if (!st.bomId) return;
  try {
    const resp = await apiPost('/api/model-bom/' + st.bomId + '/relink', { component_id: componentId });
    if (resp && resp.ok) {
      showToast('Позиция сопоставлена со складом', 'success');
      closeBomRelink();
      _doBomPreview();
    } else {
      showToast((resp && resp.data && resp.data.message) || 'Не удалось сопоставить', 'error');
    }
  } catch (e) {
    showToast('Ошибка сопоставления', 'error');
  }
}

function closeBomRelink() {
  const ov = document.getElementById('bom-relink-overlay');
  if (ov) ov.style.display = 'none';
}

// ---- Взять тех.карту (BOM) из другой модели ----
// Когда новая модель почти как существующая — копируем её BOM, потом
// убираем лишнее и добавляем своё (быстрее, чем заводить с нуля).
function openBomCopyFrom(targetId, targetName) {
  state._bomCopy = { targetId: targetId, targetName: targetName || '' };
  let ov = document.getElementById('bom-copy-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'bom-copy-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.onclick = function (e) { if (e.target === ov) closeBomCopy(); };
    document.body.appendChild(ov);
  }
  ov.innerHTML =
    '<div onclick="event.stopPropagation()" style="background:var(--card,#fff);border-radius:14px;max-width:560px;width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;">' +
      '<div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);">' +
        '<h3 style="margin:0;font-size:16px;"><i class="ti ti-copy"></i> Взять BOM из модели</h3>' +
        '<button class="modal-close" onclick="closeBomCopy()" style="background:none;border:none;font-size:20px;cursor:pointer;"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:14px 18px;overflow:auto;">' +
        '<div style="font-size:13px;color:var(--text-light);margin-bottom:10px;line-height:1.45;">' +
          'Тех.карта (BOM) выбранной модели скопируется в <b>' + escapeHtml(targetName || '') + '</b> — дальше убери лишнее и добавь своё. Существующие позиции не задвоятся.' +
        '</div>' +
        '<input id="bom-copy-search" type="text" placeholder="Поиск модели по названию или артикулу…" ' +
          'oninput="_bomCopySearchDebounced(this.value)" ' +
          'style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;box-sizing:border-box;margin-bottom:10px;font-size:14px;">' +
        '<div id="bom-copy-results"><div style="padding:16px;text-align:center;color:var(--text-light);">Начни вводить название модели…</div></div>' +
      '</div>' +
    '</div>';
  ov.style.display = 'flex';
  setTimeout(function () { const i = document.getElementById('bom-copy-search'); if (i) i.focus(); }, 50);
}

let _bomCopyDebounce = null;
function _bomCopySearchDebounced(q) {
  clearTimeout(_bomCopyDebounce);
  _bomCopyDebounce = setTimeout(function () { _doBomCopySearch(q); }, 250);
}

async function _doBomCopySearch(q) {
  const box = document.getElementById('bom-copy-results');
  if (!box) return;
  q = (q || '').trim();
  if (!q) { box.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-light);">Начни вводить название модели…</div>'; return; }
  try {
    const data = await apiGet('/api/models?search=' + encodeURIComponent(q));
    const tgt = (state._bomCopy || {}).targetId;
    const models = (data.models || []).filter(m => m.id !== tgt).slice(0, 50);
    if (!models.length) {
      box.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-light);">Ничего не найдено</div>';
      return;
    }
    box.innerHTML = models.map(function (m) {
      const art = m.article ? ('<span style="color:var(--text-light);font-size:12px;"> · ' + escapeHtml(m.article) + '</span>') : '';
      return '<div class="bom-relink-row" onclick="copyBomFrom(' + m.id + ', ' + JSON.stringify(m.name || '').replace(/"/g, '&quot;') + ')" ' +
        'style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;">' +
        '<div style="font-weight:600;">' + escapeHtml(m.name || '') + art + '</div>' +
        '<i class="ti ti-arrow-right" style="color:var(--text-light);"></i>' +
      '</div>';
    }).join('');
  } catch (e) {
    box.innerHTML = '<div style="padding:16px;text-align:center;color:#c0392b;">Ошибка загрузки</div>';
  }
}

async function copyBomFrom(sourceId, sourceName) {
  const st = state._bomCopy || {};
  if (!st.targetId) return;
  if (!confirm('Взять тех.карту (BOM) из «' + (sourceName || '') + '»?\n\nПозиции добавятся в текущую модель — дальше сможешь убрать лишнее и добавить своё.')) return;
  try {
    const resp = await apiPost('/api/models/' + st.targetId + '/bom/copy-from', { source_model_id: sourceId });
    if (resp && resp.ok) {
      const c = resp.data || {};
      showToast('Добавлено позиций: ' + (c.copied || 0) + (c.skipped ? ' (дублей пропущено: ' + c.skipped + ')' : ''), 'success');
      closeBomCopy();
      if (typeof loadModelBom === 'function') loadModelBom(st.targetId);
    } else {
      showToast((resp && resp.data && resp.data.message) || 'Не удалось скопировать', 'error');
    }
  } catch (e) {
    showToast('Ошибка копирования', 'error');
  }
}

function closeBomCopy() {
  const ov = document.getElementById('bom-copy-overlay');
  if (ov) ov.style.display = 'none';
}

document.querySelectorAll('#ip-section .chip-option').forEach(c => {
  c.addEventListener('click', () => {
    document.querySelectorAll('#ip-section .chip-option').forEach(x => x.classList.remove('selected'));
    c.classList.add('selected');
    state.newAssembly.ipClass = c.dataset.ip;
  });
});

function changeQty(delta) {
  const input = document.getElementById('qty-input');
  let v = parseInt(input.value) || 1;
  v += delta;
  if (v < 1) v = 1;
  if (v > 1000) v = 1000;
  input.value = v;
  state.newAssembly.quantity = v;
  document.getElementById('qty-minus').disabled = v <= 1;
  refreshBomPreview();
}

document.getElementById('qty-input').addEventListener('input', function() {
  let v = parseInt(this.value);
  if (isNaN(v) || v < 1) v = 1;
  if (v > 1000) v = 1000;
  state.newAssembly.quantity = v;
});

document.getElementById('qty-input').addEventListener('blur', function() {
  let v = parseInt(this.value);
  if (isNaN(v) || v < 1) { v = 1; this.value = 1; }
  state.newAssembly.quantity = v;
});

document.querySelectorAll('.date-row .chip-option').forEach(c => {
  c.addEventListener('click', () => {
    document.querySelectorAll('.date-row .chip-option').forEach(x => x.classList.remove('selected'));
    c.classList.add('selected');
    state.newAssembly.dateMode = c.dataset.date;
    const wrap = document.getElementById('date-input-wrap');
    if (c.dataset.date === 'custom') {
      wrap.classList.add('visible');
      const dateInput = document.getElementById('date-input');
      if (!dateInput.value) dateInput.value = todayIso();
      state.newAssembly.customDate = dateInput.value;
    } else {
      wrap.classList.remove('visible');
    }
  });
});

document.getElementById('date-input').addEventListener('change', function() {
  state.newAssembly.customDate = this.value;
});

document.getElementById('comment-input').addEventListener('input', function() {
  state.newAssembly.comment = this.value;
  document.getElementById('comment-counter-text').textContent = this.value.length;
});

// v2.42.2: переключатель «Готово / Занимается» — хранит выбор в state
// v2.43.14: формулировки уточнены: in_progress = «Взять в работу», ready = «Записать как готово»
function setAssemblyStatusToggle(status) {
  state.newAssembly = state.newAssembly || {};
  state.newAssembly.initialStatus = status;
  const r = document.getElementById('status-toggle-ready');
  const p = document.getElementById('status-toggle-in-progress');
  const lbl = document.getElementById('submit-assembly-label');
  if (r) r.classList.toggle('active', status === 'ready');
  if (p) p.classList.toggle('active', status === 'in_progress');
  if (lbl) lbl.textContent = status === 'in_progress' ? 'Взять в работу' : 'Записать как готово';
}

async function submitAssembly() {
  const errEl = document.getElementById('submit-error');
  const btn = document.getElementById('submit-assembly-btn');
  errEl.textContent = '';

  const a = state.newAssembly;
  const isAssembly = (a.workType || 'assembly') === 'assembly';
  // v2.43.78: in_progress теперь допустим для всех типов работ (карточка в канбане).
  const initialStatus = (a.initialStatus === 'in_progress') ? 'in_progress' : 'ready';
  if (isAssembly) {
    if (!a.model) { errEl.textContent = 'Выберите модель'; return; }
    if (a.model.exec_mode === 'choice' && !a.execution) { errEl.textContent = 'Укажите исполнение'; return; }
    if (a.model.needs_ip && !a.ipClass) { errEl.textContent = 'Укажите IP-класс'; return; }
  } else {
    if (!a.description || !a.description.trim()) {
      errEl.textContent = 'Опишите что было сделано';
      return;
    }
  }
  if (!a.quantity || a.quantity < 1) { errEl.textContent = 'Укажите количество'; return; }
  if (a.workerIds.length === 0) { errEl.textContent = 'Выберите хотя бы одного исполнителя'; return; }

  let assemblyDate;
  if (a.dateMode === 'today') assemblyDate = todayIso();
  else if (a.dateMode === 'yesterday') assemblyDate = yesterdayIso();
  else if (a.dateMode === 'custom') {
    if (!a.customDate) { errEl.textContent = 'Выберите дату'; return; }
    assemblyDate = a.customDate;
  }

  const payload = {
    work_type: a.workType || 'assembly',
    model_id: isAssembly && a.model ? a.model.id : null,
    quantity: a.quantity,
    assembly_date: assemblyDate,
    worker_ids: a.workerIds,
    execution: isAssembly && a.model && a.model.exec_mode === 'choice' ? a.execution : null,
    ip_class: isAssembly && a.model && a.model.needs_ip ? a.ipClass : null,
    comment: a.comment || '',
    contract_id: a.contractId || null,
    description: a.description || null,
    location: a.location || null,
    hours_spent: a.hours_spent || null,
    initial_status: initialStatus,
  };

  btn.disabled = true;
  const loadingLabel = initialStatus === 'in_progress' ? 'Берём в работу…' : 'Записываем…';
  btn.innerHTML = '<i class="ti ti-loader"></i> ' + loadingLabel;

  try {
    const r = await apiPost('/api/assemblies', payload);
    if (!r.ok) {
      errEl.textContent = (r.data && (r.data.message || r.data.error)) || 'Ошибка записи';
      btn.disabled = false;
      const lbl = initialStatus === 'in_progress' ? 'Взять в работу' : 'Записать как готово';
      btn.innerHTML = '<i class="ti ti-check"></i> ' + lbl;
      return;
    }
    const okMsg = initialStatus === 'in_progress'
      ? 'Работа взята в процесс: ID ' + r.data.id
      : 'Запись сохранена: ID ' + r.data.id;
    showToast(okMsg, 'success');
    // v2.43.80: если канбан-синк упал — показываем причину отдельным тостом
    if (r.data.kanban_sync_error) {
      setTimeout(() => showToast('Канбан не обновился: ' + r.data.kanban_sync_error, 'error'), 1600);
    }
    // ЭТАП 32: уведомления о списании комплектующих
    if (r.data.bom_writeoff && r.data.bom_writeoff.count) {
      setTimeout(() => showToast('Списано со склада: ' + r.data.bom_writeoff.count + ' поз.', 'success'), 1200);
    }
    if (r.data.bom_warning) {
      setTimeout(() => showToast('⚠ ' + r.data.bom_warning, 'error'), 2400);
    }
    // ЭТАП 42 (v2.20.0): если сборка автоматически прирезервирована под открытый договор
    if (r.data.auto_reserved_to) {
      const ar = r.data.auto_reserved_to;
      const cn = ar.contract_number || ('#' + ar.contract_id);
      setTimeout(() => showToast('🔗 Зарезервирована под договор ' + cn, 'success'), 1800);
    }
    cache.dashboard = null;
    cache.history = {};
    cache.summary = {};
    // Сбрасываем кэш комплектующих — qty изменились
    cache.components = null;
    cache.contractsWithProgress = null;
    cache.contracts = null;
    // v2.43.14: сбрасываем kanban-кэш (карточка появится на главной)
    cache.productionKanban = null;
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-check"></i> Взять в работу';
      selectSidebarItem('dashboard');
    }, 800);
  } catch (e) {
    errEl.textContent = 'Ошибка соединения: ' + String(e);
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> Взять в работу';
  }
}

// ============ ОБРАБОТЧИКИ ============

document.querySelectorAll('.section-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.classList.contains('disabled')) return;
    selectSection(tab.dataset.section);
  });
});

document.querySelectorAll('.m-section-tabs button').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.classList.contains('disabled')) return;
    selectSection(tab.dataset.section);
  });
});

document.querySelectorAll('#history-filters .filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#history-filters .filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.historyFilter = chip.dataset.hf;
    loadHistory();
  });
});

document.querySelectorAll('#summary-filters .filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#summary-filters .filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const sf = chip.dataset.sf;
    state.summaryFilter = sf;
    const customPanel = document.getElementById('summary-custom-range');
    if (sf === 'custom') {
      // Показываем панель с from/to. По умолчанию: последние 7 дней.
      if (customPanel) {
        const today = new Date();
        const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
        const toIso = (dt) => dt.toISOString().slice(0, 10);
        const fromEl = document.getElementById('summary-custom-from');
        const toEl   = document.getElementById('summary-custom-to');
        if (fromEl && !fromEl.value) fromEl.value = toIso(weekAgo);
        if (toEl   && !toEl.value)   toEl.value   = toIso(today);
        customPanel.style.display = 'flex';
      }
      // Загружаем сразу за дефолтные даты
      applySummaryCustomRange();
    } else {
      if (customPanel) customPanel.style.display = 'none';
      state.summaryCustomFrom = null;
      state.summaryCustomTo = null;
      loadSummary();
    }
  });
});

// v2.43.43: применение произвольного периода
function applySummaryCustomRange() {
  const fromEl = document.getElementById('summary-custom-from');
  const toEl   = document.getElementById('summary-custom-to');
  if (!fromEl || !toEl) return;
  const from = (fromEl.value || '').trim();
  const to   = (toEl.value   || '').trim();
  if (!from || !to) {
    showToast('Укажите обе даты', 'error');
    return;
  }
  if (from > to) {
    showToast('Дата «С» должна быть раньше «По»', 'error');
    return;
  }
  state.summaryCustomFrom = from;
  state.summaryCustomTo   = to;
  state.summaryFilter     = 'custom';
  loadSummary();
}

// ЭТАП 16В: фильтры задач
function _syncTasksFilterActive(tf) {
  document.querySelectorAll('#tasks-filters .filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.tf === tf);
  });
  document.querySelectorAll('#m-tasks-filter-chips .m-filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.tf === tf);
  });
}
document.querySelectorAll('#tasks-filters .filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    state.tasksFilter = chip.dataset.tf;
    _syncTasksFilterActive(chip.dataset.tf);
    loadTasksList();
  });
});
// v2.45.81: мобильные чипсы → синхронизация с десктопными и загрузка
document.querySelectorAll('#m-tasks-filter-chips .m-filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    state.tasksFilter = chip.dataset.tf;
    _syncTasksFilterActive(chip.dataset.tf);
    loadTasksList();
  });
});

document.getElementById('model-search').addEventListener('input', function() {
  renderModelModalList(this.value.trim().toLowerCase());
});

document.getElementById('model-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModelModal();
});

// ============ КОД ИЗ TG ============

const codeInput = document.getElementById('code-input');
if (codeInput) {
  codeInput.addEventListener('input', function() {
    this.value = this.value.replace(/\D/g, '');
    if (this.value.length === 6) submitCode();
  });
  codeInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') submitCode(); });
}

// ============================================================================
// ============ ПРОДАЖИ — Этап 13Б ============================================
// ============================================================================

// --------- ХЕЛПЕРЫ ----------

function formatMoney(amount) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = Number(amount);
  if (isNaN(n)) return '—';
  // Разделитель тысяч пробел, без копеек
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
}

function statusBadgeHtml(status, label) {
  return '<span class="status-badge status-' + status + '">' + escapeHtml(label || '—') + '</span>';
}

function legalEntityShort(code) {
  if (code === 'ooo_atomus') return 'ООО «Атомус Групп» (с НДС)';
  if (code === 'ooo_td_atomus') return 'ООО ТД «Атомус Групп» (без НДС)';
  return code || '—';
}

function legalEntityShortName(code) {
  if (code === 'ooo_atomus') return 'ООО «Атомус Групп»';
  if (code === 'ooo_td_atomus') return 'ООО ТД «Атомус Групп»';
  return code || '—';
}

// --------- ЗАГРУЗКА ----------

async function loadSalesDashboard() {
  const container = document.getElementById('sales-dashboard-content');
  container.innerHTML = '<div class="loading-block">Загружаем сводку…</div>';
  try {
    // Подгружаем все договоры (с подсчётами по статусам)
    const d = await apiGet('/api/contracts?limit=200');
    cache.contracts = d.contracts || [];
    cache.contractsCounts = d.counts || {};
    renderSalesDashboard();
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderSalesDashboard() {
  const container = document.getElementById('sales-dashboard-content');
  const contracts = cache.contracts || [];
  const counts = cache.contractsCounts || {};

  let html = '';

  // KPI
  html += '<div class="kpi-grid">';
  html += kpiCard('всего', counts.total || 0, 'договоров');
  html += kpiCard('в производстве', counts.production || 0, '');
  html += kpiCard('к отгрузке', counts.ready || 0, '');
  html += kpiCard('отгружено', counts.shipped || 0, '');
  html += '</div>';

  // Плитки быстрого доступа (только на мобильном — на десктопе всё в сайдбаре)
  if (!state.isDesktop) {
    html += '<div class="more-section-title" style="padding: 14px 18px 4px;">БЫСТРЫЙ ДОСТУП</div>';
    html += '<div class="quick-tiles">';
    html += '<div class="quick-tile" onclick="selectSidebarItem(\'sales-offers\')">' +
      '<div class="qt-icon"><i class="ti ti-file-invoice"></i></div>' +
      '<div class="qt-body"><div class="qt-title">КП</div><div class="qt-meta">Коммерческие предложения</div></div>' +
      '</div>';
    html += '<div class="quick-tile" onclick="selectSidebarItem(\'sales-contractors\')">' +
      '<div class="qt-icon"><i class="ti ti-briefcase"></i></div>' +
      '<div class="qt-body"><div class="qt-title">Контрагенты</div><div class="qt-meta">База клиентов</div></div>' +
      '</div>';
    html += '<div class="quick-tile" onclick="selectSidebarItem(\'sale-products\')">' +
      '<div class="qt-icon"><i class="ti ti-shopping-cart"></i></div>' +
      '<div class="qt-body"><div class="qt-title">Каталог</div><div class="qt-meta">Продажная номенклатура</div></div>' +
      '</div>';
    html += '<div class="quick-tile" onclick="selectSidebarItem(\'sales-more\')">' +
      '<div class="qt-icon"><i class="ti ti-menu-2"></i></div>' +
      '<div class="qt-body"><div class="qt-title">Ещё</div><div class="qt-meta">Профиль и настройки</div></div>' +
      '</div>';
    html += '</div>';
  }

  // ЭТАП 15: блок прогресса по договорам в работе
  html += '<div id="sales-progress-block"></div>';

  // Срочные — те у которых delivery_date близко (в течение 7 дней) и не закрыты
  const today = new Date();
  const weekAhead = new Date(today); weekAhead.setDate(today.getDate() + 7);
  const todayStr = today.toISOString().slice(0, 10);
  const weekStr = weekAhead.toISOString().slice(0, 10);

  const urgent = contracts.filter(c =>
    c.status !== 'closed' && c.delivery_date &&
    c.delivery_date >= todayStr && c.delivery_date <= weekStr
  ).slice(0, 5);

  if (urgent.length) {
    html += '<div class="section"><h3 class="section-title">Срочные · сроки в ближайшие 7 дней <a onclick="selectSidebarItem(\'sales-contracts\')">Все →</a></h3>';
    html += '<div class="card" style="padding: 0;">';
    urgent.forEach(c => html += renderContractRowInline(c));
    html += '</div></div>';
  }

  // Последние созданные
  if (contracts.length) {
    html += '<div class="section"><h3 class="section-title">Последние договоры <a onclick="selectSidebarItem(\'sales-contracts\')">Все →</a></h3>';
    html += '<div class="card" style="padding: 0;">';
    contracts.slice(0, 5).forEach(c => html += renderContractRowInline(c));
    html += '</div></div>';
  }

  if (!contracts.length) {
    html += '<div class="empty-block"><i class="ti ti-file-text"></i>Пока нет ни одного договора';
    if (canManageSales()) {
      html += '<br><br><button class="btn btn-primary" onclick="openNewContract()" style="margin: 0 auto;"><i class="ti ti-plus"></i> Создать первый</button>';
    }
    html += '</div>';
  }

  container.innerHTML = html;

  // ЭТАП 15: после рендера — асинхронно подгружаем прогресс
  loadContractsProgressForSales();
}

function renderContractRowInline(c) {
  // ЭТАП 38 (v2.18.0): подсветка иконки по срочности
  const urgCls = getContractUrgencyClass(c);
  const urgColors = {
    'urg-overdue': '#DC2626',
    'urg-urgent':  '#DC2626',
    'urg-soon':    '#F59E0B',
    'urg-ok':      '#10B981',
    'urg-nodate':  '',  // дефолтный
    'urg-done':    '#9CA3AF',
  };
  const c1 = urgColors[urgCls] || '';
  const iconStyle = c1
    ? ' style="background:' + c1 + '22; color:' + c1 + ';"'  // 22 = ~13% opacity hex
    : '';
  // Краткая строка договора (для дашборда и связанных списков)
  return '<div class="record" onclick="openContract(' + c.id + ')">' +
    '<div class="record-icon"' + iconStyle + '><i class="ti ti-file-text"></i></div>' +
    '<div class="record-body">' +
      '<div class="record-title">' + escapeHtml(c.number || '—') + ' · ' + escapeHtml(c.contractor_name || '—') + '</div>' +
      '<div class="record-meta">' +
        (c.delivery_date ? 'срок ' + formatDate(c.delivery_date) + ' · ' : '') +
        escapeHtml(c.manager_name || 'без менеджера') +
      '</div>' +
    '</div>' +
    '<div style="display: flex; align-items: center;">' +
      statusBadgeHtml(c.status, c.status_label) +
    '</div></div>';
}

// --------- СПИСОК ДОГОВОРОВ ----------

async function loadContracts() {
  const container = document.getElementById('sc-content');
  // Если уже есть кэш — рендерим сразу, потом обновляем
  if (cache.contracts) {
    renderContractsList();
  } else {
    container.innerHTML = '<div class="loading-block">Загружаем договоры…</div>';
  }
  try {
    const d = await apiGet('/api/contracts?limit=500');
    cache.contracts = d.contracts || [];
    cache.contractsCounts = d.counts || {};
    renderContractsList();
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

// v2.45.293: единая подпись типа договора (3 значения)
function _contractTypeLabel(t) {
  if (t === 'supply_install') return 'поставка с монтажом';
  if (t === 'install_only')   return 'только монтаж';
  return 'поставка';
}

function renderContractsList() {
  const container = document.getElementById('sc-content');
  const counts = cache.contractsCounts || {};
  const filter = state.salesContractsFilter;
  const search = (state.salesContractsSearch || '').toLowerCase().trim();

  // Обновляем счётчики в чипсах
  document.querySelectorAll('#sc-filters .filter-chip').forEach(chip => {
    const k = chip.dataset.scf;
    const baseLabels = {
      'all': 'Все', 'production': 'В производстве', 'ready': 'Готов к отгрузке',
      'shipped': 'Отгружен', 'closed': 'Закрыт',
    };
    let count = 0;
    if (k === 'all') count = counts.total || 0;
    else count = counts[k] || 0;
    chip.textContent = baseLabels[k] + (count ? ' · ' + count : '');
    chip.classList.toggle('active', k === filter);
  });

  // Подзаголовок
  const sub = document.getElementById('sc-subtitle');
  if (sub) {
    if (counts.total) sub.textContent = 'Всего ' + counts.total + ' договоров · в работе ' + ((counts.production || 0) + (counts.ready || 0));
    else sub.textContent = 'Договоров пока нет';
  }

  // Фильтрация
  let list = cache.contracts || [];
  if (filter !== 'all') {
    list = list.filter(c => c.status === filter);
  }
  if (search) {
    list = list.filter(c =>
      (c.number || '').toLowerCase().includes(search) ||
      (c.contractor_name || '').toLowerCase().includes(search) ||
      (c.comment || '').toLowerCase().includes(search) ||
      (c.manager_name || '').toLowerCase().includes(search)
    );
  }

  if (!list.length) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-file-text"></i>Нет договоров под этот фильтр</div>';
    return;
  }

  // На десктопе — таблица, на мобильном — карточки
  if (state.isDesktop) {
    let html = '<div style="padding: 0 0 16px;"><div class="contracts-table">';
    html += '<div class="ct-header">' +
      '<div></div>' + // v2.43.58: место под цветную полоску статуса
      '<div>Номер</div><div>Контрагент / описание</div><div>Статус</div>' +
      '<div>Дата</div><div>Срок</div><div style="text-align: right;">Сумма</div>' +
      '<div>Менеджер</div><div></div>' +
      '</div>';
    list.forEach(c => {
      const desc = [];
      desc.push(_contractTypeLabel(c.contract_type));
      desc.push(legalEntityShortName(c.legal_entity));
      const statusCls = c.status ? ('s-' + c.status) : '';
      // v2.45.13: подсветка по сроку отгрузки
      const urgCls = getContractUrgencyClass(c);
      const isOverdue = urgCls === 'urg-overdue';
      const isUrgent  = urgCls === 'urg-urgent';
      // Плашка ПРОСРОЧЕН / ГОРИТ рядом со статусом
      let urgPill = '';
      if (isOverdue) {
        urgPill = ' <span class="ct-urg-pill ct-urg-overdue" title="Срок отгрузки прошёл"><i class="ti ti-alert-triangle"></i>ПРОСРОЧЕН</span>';
      } else if (isUrgent) {
        urgPill = ' <span class="ct-urg-pill ct-urg-urgent" title="Срок отгрузки ≤ 3 дней"><i class="ti ti-clock"></i>ГОРИТ</span>';
      }
      const deliveryCls = 'ct-date' + (isOverdue ? ' ct-date-overdue' : isUrgent ? ' ct-date-urgent' : '');
      html += '<div class="ct-row ' + statusCls + ' ' + urgCls + '" onclick="openContract(' + c.id + ')">' +
        '<div class="ct-strip"></div>' + // v2.43.58: цветной индикатор статуса
        '<div class="ct-number">' + escapeHtml(c.number || '—') + '</div>' +
        '<div class="ct-name">' + escapeHtml(c.contractor_name || '—') +
          '<small>' + escapeHtml(desc.join(' · ')) + '</small></div>' +
        '<div class="ct-status">' + statusBadgeHtml(c.status, c.status_label) + urgPill + '</div>' +
        '<div class="ct-date">' + (c.sign_date ? formatDate(c.sign_date) + '.' + (c.sign_date.split('-')[0].slice(2)) : '—') + '</div>' +
        '<div class="' + deliveryCls + '">' + (c.delivery_date ? formatDate(c.delivery_date) : '—') + '</div>' +
        '<div class="ct-sum">' + (canSeeMoney() ? formatMoney(c.sum_amount) : '') + '</div>' +
        '<div class="ct-manager">' + escapeHtml(c.manager_name || '—') + '</div>' +
        '<div class="ct-arrow"><i class="ti ti-chevron-right"></i></div>' +
        '</div>';
    });
    html += '</div></div>';
    container.innerHTML = html;
  } else {
    let html = '<div class="contract-cards" style="padding-top: 12px; padding-bottom: 20px;">';
    list.forEach(c => {
      // ЭТАП 38 (v2.18.0): класс срочности
      const urgCls = getContractUrgencyClass(c);
      html += '<div class="contract-card ' + urgCls + '" onclick="openContract(' + c.id + ')">' +
        '<div class="cc-top">' +
          '<span class="cc-num">' + escapeHtml(c.number || '—') + '</span>' +
          statusBadgeHtml(c.status, c.status_label) +
        '</div>' +
        '<div class="cc-name">' + escapeHtml(c.contractor_name || '—') + '</div>' +
        '<div class="cc-meta">' +
          '<span>' + escapeHtml(_contractTypeLabel(c.contract_type)) + '</span>' +
          (c.delivery_date ? '<span><b>срок</b> ' + formatDate(c.delivery_date) + '</span>' : '') +
          (canSeeMoney() && c.sum_amount ? '<span><b>сумма</b> ' + formatMoney(c.sum_amount) + '</span>' : '') +
        '</div>' +
        '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  }
}

// --------- КАРТОЧКА ДОГОВОРА ----------

function openContract(contractId) {
  state.currentContractId = contractId;
  // v2.43.27: запоминаем id, чтобы при F5 на странице договора восстановиться
  try { localStorage.setItem('atomus_last_contract_id', String(contractId)); } catch (e) {}
  selectSidebarItem('sales-contract-detail');
}

async function loadCurrentContract() {
  const container = document.getElementById('scd-content');
  const cid = state.currentContractId;
  if (!cid) {
    container.innerHTML = '<div class="empty-block">Договор не выбран</div>';
    return;
  }
  container.innerHTML = '<div class="loading-block">Загружаем договор…</div>';
  try {
    // v2.43.19: cache-busting (см. loadContractItemsBlock)
    const ts = Date.now();
    const c = await apiGet('/api/contracts/' + cid + '?_=' + ts);
    // ЭТАП 40 (v2.20.0): подгружаем готовность к отгрузке для замка 🔒 на кнопке «Отгружен».
    // Не блокируем рендер — если запрос упал, просто без замка.
    const showLock = c.status && !['draft', 'closed', 'shipped'].includes(c.status);
    if (showLock) {
      try {
        const r = await apiGet('/api/contracts/' + cid + '/shipping-readiness?_=' + ts);
        c.shipping_readiness = r;
      } catch (e) { /* без замка тоже норм */ }
    }
    renderContractDetail(c);
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderContractDetail(c) {
  // ЭТАП 16В-2: запоминаем для openNewTaskForContract
  state.lastLoadedContract = c;
  // Заголовки
  document.getElementById('scd-title').textContent = c.number || '—';
  document.getElementById('scd-mobile-title').textContent = c.number || 'Договор';
  document.getElementById('scd-subtitle').textContent =
    (c.sign_date ? 'от ' + formatDateLong(c.sign_date) : '') + ' · ' +
    _contractTypeLabel(c.contract_type);

  const container = document.getElementById('scd-content');
  const canEdit = canManageSales();

  let html = '';

  // Шапка с контрагентом + статус
  html += '<div class="contract-header-card">';
  html += '<div class="ch-top">';
  html += '<div>';
  html += '<div class="ch-contractor-label">КОНТРАГЕНТ</div>';
  html += '<div class="ch-contractor-name">' + escapeHtml(c.contractor_name || '—') + '</div>';
  const meta = [];
  if (c.contractor_inn) meta.push('ИНН ' + escapeHtml(c.contractor_inn));
  if (c.contractor_phone) meta.push('☎ ' + escapeHtml(c.contractor_phone));
  if (c.contractor_contact_person) meta.push(escapeHtml(c.contractor_contact_person));
  if (meta.length) html += '<div class="ch-contractor-meta">' + meta.join(' · ') + '</div>';
  html += '</div>';
  html += '<div>' + statusBadgeHtml(c.status, c.status_label) + '</div>';
  html += '</div>';

  // v2.19.0: блок «Опубликовать договор» для draft + скрываем status-changer пока draft
  const isDraft = (c.status === 'draft');
  if (isDraft && canEdit) {
    html += '<div class="publish-contract-block">';
    html += '<div class="pcb-text">';
    html += '<div class="pcb-title"><i class="ti ti-file-alert"></i> Это черновик договора</div>';
    html += '<div class="pcb-desc">Договор не виден другим сотрудникам как «в работе». Опубликуйте — система зарезервирует свободные сборки и комплектующие со склада, и все сотрудники увидят его в производстве.</div>';
    html += '</div>';
    html += '<button class="publish-contract-btn" onclick="publishContract(' + c.id + ')"><i class="ti ti-rocket"></i>Опубликовать договор</button>';
    html += '</div>';
  }

  // Переключатель статуса (если есть права и НЕ draft)
  if (canEdit && !isDraft) {
    html += '<div style="font-size: 11px; color: var(--text-light); text-transform: uppercase; letter-spacing: 0.4px; margin-top: 16px; margin-bottom: 4px;">ИЗМЕНИТЬ СТАТУС</div>';
    // ЭТАП 40 (v2.20.0): добавлен шаг partially_shipped между ready и shipped
    const steps = [
      { code: 'production',        label: 'В производстве' },
      { code: 'ready',             label: 'Готов к отгрузке' },
      { code: 'partially_shipped', label: 'Отгружен частично', extraCls: 's-partial' },
      { code: 'shipped',           label: 'Отгружен' },
      { code: 'closed',            label: 'Закрыт' },
    ];
    const currentIdx = steps.findIndex(s => s.code === c.status);
    // Замок на «Отгружен», если бэк сказал что не все позиции готовы
    const readiness = c.shipping_readiness;
    const showLock = readiness && readiness.ready === false;
    html += '<div class="status-changer">';
    steps.forEach((s, i) => {
      let cls = 'status-step';
      if (s.extraCls) cls += ' ' + s.extraCls;
      if (i < currentIdx) cls += ' passed';
      else if (i === currentIdx) cls += ' current';
      if (s.code === 'shipped' && showLock && i !== currentIdx) cls += ' locked';
      const titleAttr = (s.code === 'shipped' && showLock)
        ? ' title="Не все позиции готовы — клик откроет список"'
        : '';
      html += '<button class="' + cls + '" onclick="changeContractStatus(' + c.id + ', \'' + s.code + '\')"' + titleAttr + '>' +
        escapeHtml(s.label) + '</button>';
    });
    html += '</div>';
    // Подсказка про блокеры (краткая)
    if (showLock && readiness.blockers && readiness.blockers.length) {
      const ready = readiness.items_ready || 0;
      const total = readiness.items_total || 0;
      html += '<div style="font-size:12px;color:#b45309;margin:-4px 0 8px 4px;">' +
        '<i class="ti ti-info-circle"></i> Готово ' + ready + ' из ' + total +
        ' позиций. Нажмите «Отгружен», чтобы увидеть что не готово.</div>';
    }
    // ЭТАП 42.2 (v2.20.0): ручная кнопка пересборки резервов
    html += '<button onclick="rebuildReservations()" ' +
      'style="margin-top:6px;padding:6px 12px;font-size:12px;background:transparent;' +
      'color:var(--text-light);border:1px dashed var(--border);border-radius:6px;cursor:pointer;' +
      'transition:all 0.15s;" ' +
      'onmouseover="this.style.color=\'var(--brand)\';this.style.borderColor=\'var(--brand)\';" ' +
      'onmouseout="this.style.color=\'var(--text-light)\';this.style.borderColor=\'var(--border)\';" ' +
      'title="Пересчитать привязки сборок к договорам (cleanup + backfill)">' +
      '<i class="ti ti-refresh"></i> Пересобрать резервы</button>';
  }

  // Детали
  html += '<div class="detail-grid">';
  html += '<div class="detail-item"><div class="detail-label">Юрлицо</div>' +
          '<div class="detail-value">' + escapeHtml(legalEntityShortName(c.legal_entity)) +
          (c.legal_entity_with_vat ? ' <small style="color:var(--text-light); font-weight:400;">(с НДС ' + (c.legal_entity_vat_rate || 22) + '%)</small>' : ' <small style="color:var(--text-light); font-weight:400;">(без НДС)</small>') +
          '</div></div>';
  if (canSeeMoney()) {
    html += '<div class="detail-item"><div class="detail-label">Сумма</div>' +
            '<div class="detail-value">' + escapeHtml(formatMoney(c.sum_amount)) + '</div></div>';
  }
  html += '<div class="detail-item"><div class="detail-label">Срок отгрузки</div>' +
          '<div class="detail-value' + (c.delivery_date ? '' : ' muted') + '">' +
          (c.delivery_date ? formatDateLong(c.delivery_date) : 'не указан') + '</div></div>';
  // v2.45.188: менеджер + доп. менеджеры
  const _coMgrNames = (c.co_managers || []).map(m => m.name).filter(Boolean);
  const _mgrLabel = _coMgrNames.length ? 'Менеджеры' : 'Менеджер';
  const _mgrAll = [(c.manager_name || '').trim()].filter(Boolean).concat(_coMgrNames);
  html += '<div class="detail-item"><div class="detail-label">' + _mgrLabel + '</div>' +
          '<div class="detail-value' + (_mgrAll.length ? '' : ' muted') + '">' +
          escapeHtml(_mgrAll.length ? _mgrAll.join(', ') : 'не назначен') + '</div></div>';
  if (c.delivery_address) {
    html += '<div class="detail-item span-2"><div class="detail-label">Адрес доставки</div>' +
            '<div class="detail-value">' + escapeHtml(c.delivery_address) + '</div></div>';
  }
  if (c.comment) {
    html += '<div class="detail-item span-2"><div class="detail-label">Комментарий</div>' +
            '<div class="detail-value muted">' + escapeHtml(c.comment).replace(/\\n/g, '<br>') + '</div></div>';
  }
  html += '</div>';
  html += '</div>';

  // ЭТАП 15: реальный блок «Готовность по сборкам»
  // v2.45.134: в контейнере — после загрузки спецификации перерисуем его, чтобы
  // счётчик «покупных в резерве» (плашка + кнопка печати QR) стал корректным
  // (на момент первого рендера спецификация ещё не загружена).
  html += '<div id="scd-assemblies-block">' + renderContractAssembliesBlock(c) + '</div>';

  // ЭТАП 27: блок Спецификация
  html += '<div id="scd-items-block"><div class="loading-block" style="padding:14px;">Загружаем спецификацию…</div></div>';

  // ЭТАП 26: кнопка перехода в режим отгрузки + прогресс
  html += '<div id="scd-shipment-block" style="margin-top: 16px;"><div class="loading-block" style="padding:14px;">Загружаем прогресс отгрузки…</div></div>';

  // ЭТАП 26: блок управления коробками договора
  html += '<div id="scd-boxes-block" style="margin-top: 12px;"></div>';

  // ЭТАП 16В-2: блок задач по договору (контейнер, заполняется асинхронно)
  html += '<div id="scd-tasks-block"><div class="loading-block">Загружаем задачи…</div></div>';

  // v2.45.106: журнал действий по договору
  html += '<div id="scd-audit-block" style="margin-top:18px;"></div>';

  container.innerHTML = html;

  // Загрузим задачи по договору
  loadContractTasks(c.id);
  // ЭТАП 26: загружаем прогресс отгрузки
  loadContractShipmentBlock(c.id);
  // ЭТАП 26: загружаем список коробок
  loadContractBoxesBlock(c.id);
  // ЭТАП 27: загружаем спецификацию
  loadContractItemsBlock(c.id);
  // v2.45.106: журнал действий
  loadContractAuditBlock(c.id);
}

// v2.45.106: журнал действий по договору
async function loadContractAuditBlock(contractId) {
  const host = document.getElementById('scd-audit-block');
  if (!host) return;
  try {
    const d = await apiGet('/api/contracts/' + contractId + '/audit');
    const items = (d && d.items) || [];
    if (!items.length) {
      host.innerHTML = '';
      return;
    }
    const ACTION_LABELS = {
      'update_contract':       'Изменение',
      'publish_contract':      'Публикация',
      'create_contract':       'Создание',
      'delete_contract':       'Удаление',
      'ship_contract':         'Отгрузка',
      'partial_ship':          'Частичная отгрузка',
      // v2.45.138: дополняем, чтобы в истории не было английских кодов
      'refresh_reservations':  'Пересборка резервов',
      'download_spec_pdf':     'Скачан PDF спецификации',
      'download_spec_docx':    'Скачан Word спецификации',
      'create_box':            'Создана коробка',
      'delete_box':            'Удалена коробка',
      'rename_box':            'Переименована коробка',
      'create_box_item':       'Добавлено в коробку',
      'remove_box_item':       'Убрано из коробки',
      'shipment_scan_ok':      'Отгрузка по QR',
      'remove_supply_order_item': 'Удалена позиция заказа',
    };
    // v2.45.138: перевод технического payload (и старых англоязычных записей)
    // v2.45.276: + перевод имён полей в «fields: a, b, c»
    const FIELD_LABELS = {
      number:          'номер',
      sign_date:       'дата подписания',
      contractor_id:   'контрагент',
      contractor:      'контрагент',
      contract_type:   'тип договора',
      contract_kind:   'тип договора',
      legal_entity:    'юр. лицо',
      legal_entity_id: 'юр. лицо',
      sum_amount:      'сумма',
      sum:             'сумма',
      delivery_date:   'дата отгрузки',
      ship_date:       'дата отгрузки',
      payment_date:    'дата оплаты',
      pay_date:        'дата оплаты',
      manager_id:      'менеджер',
      manager:         'менеджер',
      co_manager_ids:  'соменеджеры',
      co_managers:     'соменеджеры',
      days_type:       'тип дней',
      days_count:      'количество дней',
      days:            'дни',
      priority:        'приоритет',
      status:          'статус',
      comment:         'комментарий',
      comment_text:    'комментарий',
      notes:           'примечание',
      title:           'название',
      contract_number: 'номер договора',
      address:         'адрес',
      phone:           'телефон',
      email:           'email',
      prepay_amount:   'аванс',
      prepay:          'аванс',
      discount:        'скидка',
      currency:        'валюта',
      vat:             'НДС',
      published_at:    'дата публикации',
      created_at:      'дата создания',
      updated_at:      'дата изменения',
    };
    const _translateFieldsList = (csv) => csv
      .split(',')
      .map(s => s.trim())
      .map(s => FIELD_LABELS[s] || s)
      .join(', ');
    const _prettyAuditPayload = (txt) => {
      if (!txt) return '';
      return String(txt)
        .replace(/\bfields:\s*([a-z_,\s]+)/gi, (_m, list) => 'поля: ' + _translateFieldsList(list))
        .replace(/\bstatus:/g, 'Статус:')
        .replace(/\bpartially_shipped\b/g, 'отгружен частично')
        .replace(/\bproduction\b/g, 'в производстве')
        .replace(/\bready\b/g, 'готов к отгрузке')
        .replace(/\bshipped\b/g, 'отгружен')
        .replace(/\bclosed\b/g, 'закрыт')
        .replace(/\bassemblies=/g, 'сборок=')
        .replace(/\bcomponents=/g, 'комплектующих=')
        .replace(/\bneed_buy=/g, 'к закупке=');
    };
    let html = '<div class="card" style="padding:14px 18px;">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:14px;font-weight:700;color:var(--text-dark);">' +
        '<i class="ti ti-history"></i> История изменений <span style="color:var(--text-light);font-weight:500;font-size:12px;">(' + items.length + ')</span>' +
      '</div>';
    html += '<div style="display:flex;flex-direction:column;gap:6px;">';
    items.slice(0, 20).forEach(it => {
      const dt = (it.created_at || '').replace('T', ' ').slice(0, 16);
      const who = it.employee_name || (it.chat_id ? ('chat#' + it.chat_id) : 'Система');
      const lbl = ACTION_LABELS[it.action] || it.action;
      const payload = _prettyAuditPayload(it.payload || '');
      html += '<div style="display:flex;gap:10px;font-size:12.5px;padding:6px 0;border-bottom:1px dashed #E2E8F0;">' +
        '<span style="color:var(--text-light);font-variant-numeric:tabular-nums;flex-shrink:0;">' + escapeHtml(dt) + '</span>' +
        '<span style="font-weight:600;color:#0C4A6E;flex-shrink:0;">' + escapeHtml(who) + '</span>' +
        '<span style="color:var(--text-mid);flex:1;">' + escapeHtml(lbl) + (payload ? ' · ' + escapeHtml(payload) : '') + '</span>' +
      '</div>';
    });
    html += '</div></div>';
    host.innerHTML = html;
  } catch (e) {
    host.innerHTML = '';
  }
}

// ============================================================
// ============ ЭТАП 27: СПЕЦИФИКАЦИЯ ДОГОВОРА ================
// ============================================================

// Состояние: словарь contractId → { items, total, addingMode, editingId }
state._specByContract = {};

async function loadContractItemsBlock(contractId) {
  const container = document.getElementById('scd-items-block');
  if (!container) return;
  try {
    // v2.43.19: cache-busting — Service Worker PWA может закэшировать GET-ответ
    // и продолжить отдавать старые qty_reserved/qty_in_production даже после
    // смены статуса сборки. Дёргаем уникальный URL чтобы обойти кэш.
    const ts = Date.now();
    const d = await apiGet('/api/contracts/' + contractId + '/items?_=' + ts);
    state._specByContract[contractId] = {
      items: d.items || [],
      total: d.total || 0,
      progress: d.progress || null,  // v2.43.13: прогресс готовности
      addingMode: false,
      editingId: null,
    };
    renderContractItemsBlock(contractId);
    // v2.43.13: после загрузки спецификации обновляем прогресс-бар в шапке
    renderContractProgressBar(contractId);
    // v2.45.134: перерисовываем блок готовности — теперь спецификация загружена,
    // и счётчик покупных в резерве (плашка + кнопка «Печать QR на все») верный.
    const aHost = document.getElementById('scd-assemblies-block');
    if (aHost && state.lastLoadedContract && state.lastLoadedContract.id === contractId) {
      aHost.innerHTML = renderContractAssembliesBlock(state.lastLoadedContract);
    }
  } catch (e) {
    container.innerHTML = '';
    container.style.display = 'none';
  }
}

// v2.43.13: рендер прогресс-бара готовности договора
function renderContractProgressBar(contractId) {
  const host = document.getElementById('scd-progress-block');
  if (!host) return;
  const st = state._specByContract && state._specByContract[contractId];
  const p = st && st.progress;
  if (!p || !p.total) {
    host.innerHTML = '';
    return;
  }
  const pctReady = Math.max(0, Math.min(100, Number(p.pct_ready) || 0));
  const pctInProd = Math.max(0, Math.min(100 - pctReady, Number(p.pct_in_prod) || 0));
  const pctTotal = pctReady + pctInProd;
  // Текст справа: «N% готов», доп. — «M% в работе»
  const sub = [];
  if (p.ready > 0) sub.push(_fmtQty(p.ready) + ' готово');
  if (p.in_production > 0) sub.push(_fmtQty(p.in_production) + ' в работе');
  if (p.pending > 0) sub.push(_fmtQty(p.pending) + ' к работе');
  host.innerHTML =
    '<div class="contract-progress">' +
      '<div class="cp-head">' +
        '<div class="cp-title">' +
          '<i class="ti ti-progress-check"></i> Готовность договора' +
        '</div>' +
        '<div class="cp-pct">' + pctTotal + '%</div>' +
      '</div>' +
      '<div class="cp-bar">' +
        '<div class="cp-seg cp-ready" style="width:' + pctReady + '%"></div>' +
        '<div class="cp-seg cp-inprod" style="width:' + pctInProd + '%"></div>' +
      '</div>' +
      (sub.length ? '<div class="cp-sub">' + escapeHtml(sub.join(' · ')) + '</div>' : '') +
    '</div>';
}

// v2.43.13: конвертация позиции спецификации из «продажной» в «сборочную»
// (sale_product_id → model_id). Используется когда чиллер случайно завели
// как sale_product, а должна быть модель из производственной номенклатуры.
async function convertSpecItemToModel(contractId, itemId, modelId) {
  if (!confirm('Превратить позицию в сборку? Закупка отменится, появится задание в производстве.')) return;
  try {
    const r = await apiPost('/api/contracts/items/' + itemId + '/convert-to-model', {
      model_id: modelId,
    });
    if (r && r.ok) {
      showToast('Позиция переведена в производство', 'success');
      await loadContractItemsBlock(contractId);
      cache.dashboard = null;
      cache.productionKanban = null;
    } else {
      showToast((r && r.data && r.data.message) || 'Не удалось конвертировать', 'error');
    }
  } catch (e) {
    showToast((e && e.message) || 'Ошибка конвертации', 'error');
  }
}

// v2.43.24: конвертация свободного ввода / продажной позиции в комплектующее склада.
// Используется после загрузки УПД: на складе появилось комплектующее, а в договоре
// эта же позиция всё ещё текстовая и не резервируется. Клик → связь со складом
// + сразу создаётся резерв (если хватает остатка).
async function convertSpecItemToComponent(contractId, itemId, componentId) {
  if (!confirm('Связать позицию со складом? Если есть остаток — позиция уйдёт в резерв.')) return;
  try {
    const r = await apiPost('/api/contracts/items/' + itemId + '/convert-to-component', {
      component_id: componentId,
    });
    if (r && r.ok) {
      showToast('Позиция связана со складом', 'success');
      await loadContractItemsBlock(contractId);
      cache.dashboard = null;
      cache.components = null;
    } else {
      showToast((r && r.data && r.data.message) || 'Не удалось связать', 'error');
    }
  } catch (e) {
    showToast((e && e.message) || 'Ошибка связи со складом', 'error');
  }
}

// v2.45.16: ручное сопоставление позиции спецификации с комплектующим на складе.
// Когда автомат не нашёл совпадение (например «203 LUN» vs
// «Воздухоохладитель 203 LUN» — слишком короткий артикул), пользователь
// выбирает component руками из списка с поиском.
async function openManualComponentPicker(contractId, itemId, hintName) {
  // Грузим все активные комплектующие (если ещё не в кэше)
  let components = (cache.components && cache.components.items) || cache.componentsList || null;
  if (!components) {
    try {
      const d = await apiGet('/api/components?only_active=1');
      components = d.components || d.items || [];
      cache.componentsList = components;
    } catch (e) {
      showToast('Не удалось загрузить склад', 'error');
      return;
    }
  }
  if (!components || !components.length) {
    showToast('На складе нет комплектующих', 'error');
    return;
  }
  // Предварительный фильтр — токены из имени sale_product
  const initialQuery = (hintName || '').trim();

  const overlayId = 'manual-comp-picker';
  let m = document.getElementById(overlayId); if (m) m.remove();
  m = document.createElement('div');
  m.id = overlayId;
  m.className = 'modal-overlay';
  m.innerHTML =
    '<div class="modal" style="max-width:640px;display:flex;flex-direction:column;max-height:85vh;">' +
      '<div class="modal-header">' +
        '<h2><i class="ti ti-link"></i> Сопоставить со складом</h2>' +
        '<button class="icon-btn" onclick="document.getElementById(\'' + overlayId + '\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content" style="display:flex;flex-direction:column;gap:10px;overflow:hidden;">' +
        '<div style="color:var(--text-light);font-size:13px;">Выбери комплектующее со склада — позиция станет резервироваться из готовой продукции.</div>' +
        '<input type="search" id="mcp-search" class="form-input" placeholder="Поиск по артикулу или названию…" autocomplete="off">' +
        '<div id="mcp-list" style="overflow-y:auto;border:1px solid var(--border);border-radius:8px;max-height:50vh;"></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
  m.classList.add('visible');
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });

  const searchInput = document.getElementById('mcp-search');
  const listEl = document.getElementById('mcp-list');

  const renderList = (q) => {
    const query = (q || '').toLowerCase().trim();
    const filtered = !query
      ? components.slice(0, 100)
      : components.filter(c =>
          ((c.name || '') + ' ' + (c.sku || '')).toLowerCase().includes(query)
        ).slice(0, 200);
    if (!filtered.length) {
      listEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-light);font-size:13px;">Ничего не найдено</div>';
      return;
    }
    listEl.innerHTML = filtered.map(c => {
      const stock = Number(c.qty_on_stock || 0);
      const stockBadge = stock > 0
        ? '<span style="background:#DCFCE7;color:#0A5B41;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;">' + _fmtQty(stock) + ' шт</span>'
        : '<span style="background:#FEE2E2;color:#8C2A2A;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;">нет в наличии</span>';
      return '<div style="padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;gap:10px;transition:background 0.12s;" ' +
        'onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'transparent\'" ' +
        'onclick="_pickManualComponent(' + contractId + ',' + itemId + ',' + c.id + ')">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:13px;color:var(--text-dark);font-weight:600;">' + escapeHtml(c.name || '—') + '</div>' +
          '<div style="font-size:11.5px;color:var(--text-light);">Артикул: ' + escapeHtml(c.sku || '—') + ' · ' + escapeHtml(c.category_name || '—') + '</div>' +
        '</div>' +
        stockBadge +
      '</div>';
    }).join('');
  };

  searchInput.addEventListener('input', () => renderList(searchInput.value));
  // Стартуем с подсказкой по имени sale_product
  if (initialQuery) {
    searchInput.value = initialQuery;
  }
  renderList(searchInput.value);
  setTimeout(() => searchInput.focus(), 50);
}

async function _pickManualComponent(contractId, itemId, componentId) {
  // Закрываем picker
  const m = document.getElementById('manual-comp-picker');
  if (m) m.remove();
  // Делаем привязку через существующий endpoint convert-to-component
  try {
    const r = await apiPost('/api/contracts/items/' + itemId + '/convert-to-component', {
      component_id: componentId,
    });
    if (!r || !r.ok) {
      showToast((r && r.data && r.data.message) || 'Не удалось привязать', 'error');
      return;
    }
    // Запускаем авторезерв для контракта
    try {
      await apiPost('/api/contracts/' + contractId + '/auto-link-stock', {});
    } catch (_) {}
    showToast('Связано со складом', 'success');
    await loadContractItemsBlock(contractId);
    cache.dashboard = null;
    cache.components = null;
    cache.componentsList = null;
  } catch (e) {
    showToast((e && e.message) || 'Ошибка', 'error');
  }
}

// v2.45.97/100: печать QR-наклеек для одной component-позиции.
// Печатает по одной этикетке на каждую единицу — copies = qty.
// На каждой этикетке подпись «Дог.№X · Имя позиции · 1 {unit}».
function _ccUnitLabel(it) {
  // Выбор формы единицы — учитываем «(комплект)» в имени и поле unit
  const name = (it && (it.component_name || it.name) || '').toLowerCase();
  const u = (it && it.unit || '').toLowerCase();
  if (name.includes('комплект') || u.startsWith('компл')) return 'комплект';
  if (u.startsWith('упак')) return 'упак.';
  if (u.startsWith('пара')) return 'пара';
  if (u.startsWith('метр') || u === 'м') return 'м';
  return 'шт';
}
async function printComponentItemQr(contractId, itemId) {
  // Ищем позицию в spec-блоке (state._specByContract — отдельный кеш)
  const c = state.lastLoadedContract || {};
  const spec = (state._specByContract && state._specByContract[contractId]) || {};
  const items = (spec.items && spec.items.length) ? spec.items : (c.items || []);
  const it = items.find(x => Number(x.id) === Number(itemId));
  if (!it) { showToast('Позиция не найдена', 'error'); return; }
  // v2.45.104: имя для любого типа позиции (model/component/sale/freeform)
  const itName = it.component_name || it.model_name || it.sale_product_name ||
                 it.name || ('Поз. #' + it.id);
  const qty = Math.max(1, Math.floor(Number(it.qty || it.qty_reserved || 1)));
  const unit = _ccUnitLabel(it);
  const contractNum = (c && c.contract_number) || ('#' + contractId);
  const caption = ('Дог.' + contractNum + ' · ' + itName + ' · 1 ' + unit).slice(0, 80);
  if (!confirm('Отправить на термопринтер ' + qty + ' этикет' +
               (qty === 1 ? 'ку' : (qty < 5 ? 'ки' : 'ок')) + '?\n\n' +
               'На каждой: ' + caption)) return;
  try {
    const ct = await apiGet('/api/contracts/' + contractId + '/public-token');
    // v2.45.208: QR конкретного изделия — /c/{token}?item=ID (скан → карточка позиции)
    const url = window.location.origin + '/c/' + ct.public_token + '?item=' + itemId;
    const resp = await apiPost('/api/labels/print', {
      qr_url: url,
      caption: caption,
      copies: qty,
    });
    if (resp && resp.ok) {
      const queueId = resp.data && resp.data.queue_id;
      showToast('📤 Отправлено ' + qty + ' этикеток' + (queueId ? ' (#' + queueId + ')' : ''), 'success');
    } else {
      showToast((resp && resp.data && resp.data.message) || 'Не удалось', 'error');
    }
  } catch (e) {
    showToast((e && e.message) || 'Ошибка', 'error');
  }
}

// v2.45.94: ручное обновление резервов со склада. Для случая когда позиция
// привязана к component_id, на складе остатки есть, а статус «К закупке» —
// потому что резерв не оформился автоматически при добавлении.
async function refreshContractReservations(contractId) {
  try {
    const r = await apiPost('/api/contracts/' + contractId + '/refresh-reservations', {});
    if (!r || !r.ok) {
      showToast((r && r.data && r.data.message) || 'Не удалось обновить', 'error');
      return;
    }
    const d = r.data || {};
    const aN = (d.reserved_assemblies || []).length;
    const cN = (d.reserved_components || []).length;
    const buyN = (d.need_to_buy || []).length;
    const makeN = (d.need_to_make || []).length;
    let msg = 'Зарезервировано: ' + (aN + cN);
    if (aN) msg += ' (' + aN + ' сборок)';
    if (cN) msg += ' (' + cN + ' компл.)';
    if (buyN + makeN > 0) msg += ' · не хватает: ' + (buyN + makeN);
    showToast(msg, (aN + cN) > 0 ? 'success' : 'info');
    await loadContractItemsBlock(contractId);
    cache.dashboard = null;
  } catch (e) {
    showToast((e && e.message) || 'Ошибка', 'error');
  }
}

// v2.45.14: «Быстрая кнопка починки» — авто-привязать все «продажные»
// позиции спецификации к комплектующим на складе одним вызовом.
async function autoLinkContractStock(contractId) {
  if (!confirm('Найти на складе совпадения для всех "К заказу" позиций и привязать?\n\nПозиции с найденным совпадением станут резервироваться из готовой продукции вместо «К заказу».')) return;
  try {
    const r = await apiPost('/api/contracts/' + contractId + '/auto-link-stock', {});
    if (!r || !r.ok) {
      showToast((r && r.data && r.data.message) || 'Не удалось выполнить', 'error');
      return;
    }
    const linked  = (r.data && r.data.linked) || 0;
    const skipped = (r.data && r.data.skipped) || 0;
    if (linked > 0) {
      showToast('Привязано к складу: ' + linked + (skipped ? ' · без совпадений: ' + skipped : ''), 'success');
    } else if (skipped > 0) {
      showToast('Не нашёл подходящих комплектующих на складе (' + skipped + ' позиций пропущено)', 'warning');
    } else {
      showToast('Привязывать нечего — все позиции уже корректные', 'info');
    }
    await loadContractItemsBlock(contractId);
    cache.dashboard = null;
    cache.components = null;
  } catch (e) {
    showToast((e && e.message) || 'Ошибка авто-привязки', 'error');
  }
}

// v2.19.0: бейдж резерва для позиции спецификации (v2.19.1: + покупные позиции + свободный ввод)
// v2.43.13: добавлен бейдж «Изготовляется» — для assemblies со статусом in_progress.
function _renderReservationBadge(item) {
  if (!item) return '';
  // model_id / component_id — резерв через сборки/комплектующие
  if (item.model_id || item.component_id) {
    const qty = Number(item.qty) || 0;
    const reserved = Number(item.qty_reserved || 0);
    const inProd = Number(item.qty_in_production || 0);
    if (qty <= 0) return '';
    let cls = 'r-none';
    let icon = 'ti-circle';
    let txt = '';
    if (reserved >= qty) {
      cls = 'r-full';
      icon = 'ti-circle-check';
      txt = 'В резерве';
    } else if (reserved > 0) {
      cls = 'r-partial';
      icon = 'ti-progress';
      txt = 'Резерв ' + _fmtQty(reserved) + ' из ' + _fmtQty(qty);
      if (inProd > 0) {
        txt += ' · ' + _fmtQty(inProd) + ' в работе';
      }
    } else if (inProd >= qty) {
      // v2.43.13: всё в работе
      cls = 'r-inprod';
      icon = 'ti-tool';
      txt = 'Изготовляется';
    } else if (inProd > 0) {
      // v2.43.13: частично в работе
      cls = 'r-inprod';
      icon = 'ti-tool';
      txt = 'Изготовляется ' + _fmtQty(inProd) + ' из ' + _fmtQty(qty);
    } else {
      cls = 'r-none';
      icon = 'ti-circle-dashed';
      txt = (item.model_id ? 'К сборке' : 'К закупке');
    }
    return ' <span class="spec-item-reservation ' + cls + '" title="' + escapeHtml(txt) + '">' +
      '<i class="ti ' + icon + '"></i>' + escapeHtml(txt) + '</span>';
  }
  // v2.19.1: для sale_product_id И для свободного ввода — бейдж статуса закупки
  // (по решению от 21.05.2026: свободный ввод тоже трекаем как покупное)
  return _renderPurchaseBadge(item);
}

// v2.19.1: бейдж статуса закупки для sale_product_id (кликабельный, циклически переключает состояние)
function _renderPurchaseBadge(item) {
  const status = (item.purchase_status || 'pending');
  let cls = 'b-pending', icon = 'ti-shopping-cart', txt = 'К заказу', nextStatus = 'ordered', tip = 'Клик — переключить на «Заказано»';
  if (status === 'ordered') {
    cls = 'b-ordered'; icon = 'ti-truck'; txt = 'Заказано'; nextStatus = 'received';
    tip = 'Клик — переключить на «Готово» (пришло)';
  } else if (status === 'received') {
    cls = 'b-received'; icon = 'ti-circle-check'; txt = 'Готово'; nextStatus = 'pending';
    tip = 'Клик — вернуть в «К заказу»';
  }
  const canEdit = (typeof canManageSales === 'function') ? canManageSales() : true;
  const click = canEdit
    ? ' onclick="event.stopPropagation(); cyclePurchaseStatus(' + item.id + ', \'' + nextStatus + '\')"'
    : '';
  const lockCls = canEdit ? '' : ' locked';
  const title = canEdit ? tip : ('Статус закупки: ' + txt);
  return ' <span class="spec-item-purchase ' + cls + lockCls + '"' + click + ' title="' + escapeHtml(title) + '">' +
    '<i class="ti ' + icon + '"></i>' + escapeHtml(txt) + '</span>';
}

// v2.19.1: переключение статуса закупки одной позиции
async function cyclePurchaseStatus(itemId, newStatus) {
  if (!itemId || !newStatus) return;
  try {
    const r = await apiPatch('/api/contracts/items/' + itemId + '/purchase-status', { status: newStatus });
    if (r && r.ok && r.item) {
      // Перерисуем блок спецификации
      const contractId = state.currentContractId;
      if (contractId && state._specByContract && state._specByContract[contractId]) {
        const st = state._specByContract[contractId];
        // Обновим item в кэше
        const items = st.items || [];
        const idx = items.findIndex(x => x.id === itemId);
        if (idx >= 0) items[idx] = Object.assign({}, items[idx], r.item);
        renderContractItemsBlock(contractId);
      }
      const lbl = ({pending:'К заказу', ordered:'Заказано', received:'Готово'})[newStatus] || newStatus;
      showToast('Статус: ' + lbl, 'success');
    } else {
      showToast('Не удалось обновить статус', 'error');
    }
  } catch (e) {
    showToast((e && e.message) || 'Ошибка обновления', 'error');
  }
}

// v2.43.8: обёртки клика по позиции спецификации — передают return-context
// в openSaleProductDetail / openModelDetail / openComponentDetail,
// чтобы стрелка «Назад» возвращала в этот же договор, а не на общий список.
function _openSaleProductFromSpec(productId, contractId) {
  openSaleProductDetail(productId, {
    screen: 'sales-contract-detail',
    contractId: contractId,
  });
}
function _openModelFromSpec(modelId, contractId) {
  // openModelDetail — модалка, закрытие возвращает в текущий экран (договор)
  // автоматически. Контекст пока не нужен, но оставляем функцию-обёртку
  // на будущее (если придётся добавлять кнопку «Редактировать» с переходом).
  openModelDetail(modelId);
}
function _openComponentFromSpec(componentId, contractId) {
  if (typeof openComponentDetail === 'function') openComponentDetail(componentId);
}

function renderContractItemsBlock(contractId) {
  const container = document.getElementById('scd-items-block');
  if (!container) return;
  const st = state._specByContract[contractId] || { items: [], total: 0, addingMode: false, editingId: null };
  const items = st.items;
  const total = st.total;
  const canEdit = canManageSales();

  let html = '<div class="spec-card">';
  html += '<div class="spec-head">';
  html += '<div class="spec-title"><i class="ti ti-list-details" style="color: var(--brand);"></i> Спецификация ' +
          (items.length ? '(' + items.length + ')' : '') + '</div>';
  // ЭТАП 27.4 (v2.21.4): кнопки скачивания спецификации в Word/PDF
  if (items.length) {
    html += '<div class="spec-export-buttons">';
    // v2.45.14: «Быстрая починка» — авто-привязать sale_product к комплектующим
    // на складе, чтобы не висели как «К заказу» когда реально на складе есть.
    // Показываем только если есть хоть одна sale_product-позиция без model/component.
    const hasFixable = items.some(it =>
      it.sale_product_id && !it.model_id && !it.component_id
    );
    if (canEdit && hasFixable) {
      html += '<button class="spec-export-btn spec-export-btn-fix" onclick="autoLinkContractStock(' + contractId + ')" title="Найти и привязать товары которые лежат на складе как комплектующие">' +
        '<i class="ti ti-wand"></i><span>Привязать к складу</span>' +
      '</button>';
    }
    html += '<button class="spec-export-btn" onclick="downloadContractSpecDocx(' + contractId + ')" title="Скачать Word">' +
        '<i class="ti ti-file-type-docx"></i><span>Word</span>' +
      '</button>' +
      '<button class="spec-export-btn" onclick="downloadContractSpecPdf(' + contractId + ')" title="Открыть PDF">' +
        '<i class="ti ti-file-type-pdf"></i><span>PDF</span>' +
      '</button>' +
    '</div>';
  }
  html += '</div>';
  // v2.45.316: пояснение — что такое спецификация
  html += '<div style="font-size:12px;color:var(--text-light);padding:0 0 8px;">' +
    'Всё, что поставляется клиенту по договору: и наши сборки, и покупное, и материалы.</div>';

  // Список позиций
  if (items.length) {
    html += '<div class="spec-list">';
    items.forEach((it, idx) => {
      if (st.editingId === it.id) {
        html += renderSpecForm(contractId, it);
      } else {
        const qty = it.qty || 0;
        const unit = it.unit || 'шт.';
        // Имя: либо актуальное из связанной сущности, либо snapshot
        let displayName;
        let sourceTag = '';
        // v2.45.190: вид позиции (group_name) — «Электропривод», «Гибкая вставка»…,
        // чтобы по строке было понятно ЧТО это, а не только коды/артикул.
        let typeChip = '';
        if (it.model_id && it.model_name) {
          const parts = [];
          if (it.model_article) parts.push(it.model_article);
          parts.push(it.model_name);
          displayName = parts.join(' · ');
        } else if (it.component_id && it.component_name) {
          // ЭТАП 37: комплектующее
          const parts = [];
          if (it.component_sku) parts.push(it.component_sku);
          parts.push(it.component_name);
          displayName = parts.join(' · ');
          sourceTag = '<span style="font-size:10px; color:var(--c-prod-25); text-transform:uppercase; margin-left:4px;">комплектующее</span>';
        } else if (it.sale_product_id && it.sale_product_name) {
          // ЭТАП 37: продажная позиция
          const parts = [];
          if (it.sale_product_nc_code) parts.push(it.sale_product_nc_code);
          parts.push(it.sale_product_name);
          displayName = parts.join(' · ');
          sourceTag = '<span style="font-size:10px; color:var(--brand); text-transform:uppercase; margin-left:4px;">продажа</span>';
          // v2.45.191: вид лидером строки — берём ПОДГРУППУ (она конкретнее:
          // «Приточные установки…», «Гибкие вставки…»), а группа — это слишком
          // общо («Компакты ZILON», «Сетевые элементы»). Если подгруппы нет — группа.
          const _sub = (it.sale_product_subgroup_name || '').trim();
          const _grp = (it.sale_product_group_name || '').trim();
          const _cat = (it.sale_product_category_name || '').trim();
          const _desc = (it.sale_product_description || '').trim();
          let _type = '';
          if (_sub && _sub !== '(без подгруппы)') _type = _sub;
          else if (_grp && _grp !== '(без группы)') _type = _grp;
          // v2.45.206: описание товара конкретнее категории («ВЕНТИЛЯТОРЫ ZILON»
          // против общей «Вентиляция и кондиционирование») — берём его, если есть.
          else if (_desc) _type = (_desc.length > 60 ? _desc.slice(0, 60) + '…' : _desc);
          // v2.45.205: иначе — категория товара (чтобы было видно «что это»).
          else if (_cat && _cat !== '(без категории)') _type = _cat;
          if (_type) {
            typeChip = '<span style="font-size:11px; font-weight:700; color:#1E40AF; margin-right:6px;">' + escapeHtml(_type) + '</span>';
          }
        } else {
          displayName = it.name;
          sourceTag = '<span style="font-size:10px; color:var(--text-light); text-transform:uppercase; margin-left:4px;">свободный ввод</span>';
        }
        // ЭТАП 37: meta с исполнением и IP
        const metaParts = [qty + ' ' + escapeHtml(unit)];
        if (it.execution_type === 'stainless') {
          metaParts.push('<span style="color: var(--brand); font-weight: 600;">Нержавейка</span>');
        } else if (it.execution_type === 'standard') {
          metaParts.push('<span>Обычное исп.</span>');
        }
        if (it.ip_rating) {
          metaParts.push('<span style="color: var(--c-prod-25); font-weight: 600;">' + escapeHtml(it.ip_rating) + '</span>');
        }
        // v2.43.13: бейдж резерва (для model_id и component_id)
        const _reservedBadge = _renderReservationBadge(it);
        // v2.43.18: быстрые action-кнопки прямо рядом с бейджем
        // (для model_id-позиций — синхронизируем все assembly разом)
        let _quickAction = '';
        // v2.45.94: для component-позиций, у которых резерв не оформлен —
        // кнопка «Зарезервировать со склада» (запускает refresh-reservations)
        if (canEdit && it.component_id && !it.model_id) {
          const _qty = Number(it.qty) || 0;
          const _reserved = Number(it.qty_reserved || 0);
          if (_reserved < _qty) {
            _quickAction = ' <button class="spec-quick-act sqa-ok" ' +
              'title="Зарезервировать со склада" ' +
              'onclick="refreshContractReservations(' + contractId + ')">' +
              '<i class="ti ti-package-import"></i>&nbsp;Зарезервировать</button>';
          }
        }
        if (canEdit && it.model_id) {
          const reserved = Number(it.qty_reserved || 0);
          const inProd = Number(it.qty_in_production || 0);
          if (reserved > 0) {
            // Есть готовые → даём кнопку «↩» вернуть всё в работу
            _quickAction = ' <button class="spec-quick-act" title="Вернуть все готовые сборки в работу" ' +
              'onclick="reopenSpecItemAssemblies(' + contractId + ',' + it.id + ',' + it.model_id + ')">' +
              '<i class="ti ti-arrow-back-up"></i></button>';
          } else if (inProd > 0) {
            // Есть в работе → даём кнопку «✓» отметить готовыми
            _quickAction = ' <button class="spec-quick-act sqa-ok" title="Отметить все сборки в работе готовыми" ' +
              'onclick="finishSpecItemAssemblies(' + contractId + ',' + it.id + ',' + it.model_id + ')">' +
              '<i class="ti ti-check"></i></button>';
          } else {
            // v2.45.6: ничего нет → «К сборке». Кнопка «Уже готово»
            // создаёт ready-assembly на нужный qty одним кликом — для случаев когда
            // изделие физически уже сделано и не нужен полный production pipeline.
            _quickAction = ' <button class="spec-quick-act sqa-ok" title="Уже готово — создать готовую сборку и положить в резерв" ' +
              'onclick="markSpecItemReady(' + contractId + ',' + it.id + ')">' +
              '<i class="ti ti-check"></i>&nbsp;Уже готово</button>';
          }
        }
        const meta = metaParts.join(' · ');
        // ЭТАП 38 (v2.18.0): клик по названию → открыть карточку связанной сущности
        // v2.19.1: для свободного ввода — открыть форму редактирования позиции
        // v2.43.8: запоминаем return-context чтобы стрелка «Назад» возвращала
        // в карточку договора (а не на список продаж/моделей/комплектующих).
        let nameClickHandler = '';
        let nameLinkClass = '';
        if (it.sale_product_id) {
          nameClickHandler = ' onclick="_openSaleProductFromSpec(' + it.sale_product_id + ',' + contractId + ')"';
          nameLinkClass = ' spec-item-name--link';
        } else if (it.model_id) {
          nameClickHandler = ' onclick="_openModelFromSpec(' + it.model_id + ',' + contractId + ')"';
          nameLinkClass = ' spec-item-name--link';
        } else if (it.component_id) {
          nameClickHandler = ' onclick="_openComponentFromSpec(' + it.component_id + ',' + contractId + ')"';
          nameLinkClass = ' spec-item-name--link';
        } else if (canEdit) {
          // v2.19.1: свободный ввод — клик открывает форму редактирования (если есть права)
          nameClickHandler = ' onclick="startEditSpecItem(' + contractId + ',' + it.id + ')"';
          nameLinkClass = ' spec-item-name--link';
        }
        // v2.45.199: к какой системе/объекту относится позиция
        let _sysChip = '';
        if (it.system_tag) {
          _sysChip = ' <span style="display:inline-block;font-size:10px;font-weight:700;color:#0E7490;background:rgba(14,116,144,0.10);padding:1px 7px;border-radius:6px;margin-left:4px;vertical-align:middle;" title="Относится к системе / объекту"><i class="ti ti-layout-grid" style="font-size:10px;vertical-align:-1px;"></i> ' + escapeHtml(it.system_tag) + '</span>';
        }
        // v2.45.198: пометка «закуп в другом городе, отгрузка сразу на объекте»
        let _altBadge = '', _altLine = '';
        if (it.alt_supply) {
          _altBadge = ' <span style="display:inline-block;font-size:10px;font-weight:700;color:#B45309;background:rgba(180,83,9,0.10);padding:1px 7px;border-radius:6px;margin-left:4px;vertical-align:middle;"><i class="ti ti-truck-delivery" style="font-size:11px;vertical-align:-1px;"></i> закуп в др. городе</span>';
          const _ap = [];
          if (it.alt_supply_city) _ap.push(escapeHtml(it.alt_supply_city));
          if (it.alt_supply_phone) _ap.push('тел. ' + escapeHtml(it.alt_supply_phone));
          if (it.alt_supply_comment) _ap.push(escapeHtml(it.alt_supply_comment));
          let _apHtml = _ap.join(' · ');
          if (it.alt_supply_file_key) {
            _apHtml += (_apHtml ? ' · ' : '') + '<a href="#" onclick="_openSpecAltFile(' + it.id + ');return false;" style="color:var(--brand);"><i class="ti ti-paperclip" style="vertical-align:-1px;"></i> ' + escapeHtml(it.alt_supply_file_name || 'файл') + '</a>';
          }
          _altLine = '<div class="spec-item-meta" style="color:#B45309;margin-top:2px;">Отгрузка сразу на объекте' + (_apHtml ? ' · ' + _apHtml : '') + '</div>';
        }
        // v2.45.312: позиция упакована в коробку — бейдж «в Коробке N» (клик открывает коробку)
        let _boxChip = '';
        if (it.box_id && it.box_name) {
          _boxChip = ' <span style="display:inline-block;font-size:10px;font-weight:700;color:#15803D;background:rgba(21,128,61,0.10);padding:1px 7px;border-radius:6px;margin-left:4px;vertical-align:middle;cursor:pointer;" ' +
            'title="Открыть коробку" onclick="event.stopPropagation();openBoxDetail(' + it.box_id + ')">' +
            '<i class="ti ti-package" style="font-size:11px;vertical-align:-1px;"></i> в ' + escapeHtml(it.box_name) + '</span>';
        }
        html += '<div class="spec-item">' +
          '<div class="spec-item-no">' + (it.position_no || (idx + 1)) + '</div>' +
          '<div class="spec-item-body">' +
            '<div class="spec-item-name' + nameLinkClass + '"' + nameClickHandler + '>' + escapeHtml(displayName) + sourceTag + '</div>' +
            ((typeChip || _sysChip || _altBadge || _boxChip) ? '<div class="spec-item-chips">' + typeChip + _sysChip + _altBadge + _boxChip + '</div>' : '') +
            ((_reservedBadge || _quickAction) ? '<div class="spec-item-status">' + _reservedBadge + _quickAction + '</div>' : '') +
            '<div class="spec-item-meta">' + meta + '</div>' +
            _altLine +
          '</div>' +
          '<div class="spec-item-act-col">' +
            (canEdit ? '<div class="spec-item-actions">' +
              // v2.43.13: конвертация sale_product → model, если найдена одноимённая активная модель
              (it.convertible_to_model_id ? (
                '<button class="spec-item-act-btn" style="color:#1E40AF;" ' +
                  'title="Превратить в сборку: ' + escapeHtml(it.convertible_to_model_name || '') + '" ' +
                  'onclick="convertSpecItemToModel(' + contractId + ',' + it.id + ',' + it.convertible_to_model_id + ')">' +
                  '<i class="ti ti-arrow-up-right"></i>' +
                '</button>'
              ) : '') +
              // v2.43.24: конвертация в комплектующее склада (для свободного ввода / sale_product)
              (it.convertible_to_component_id ? (
                '<button class="spec-item-act-btn" style="color:#15803D;" ' +
                  'title="Связать со складом: ' + escapeHtml(it.convertible_to_component_name || '') +
                    (it.convertible_to_component_on_stock != null
                      ? ' (на складе: ' + _fmtQty(it.convertible_to_component_on_stock) + ')'
                      : '') + '" ' +
                  'onclick="convertSpecItemToComponent(' + contractId + ',' + it.id + ',' + it.convertible_to_component_id + ')">' +
                  '<i class="ti ti-package-import"></i>' +
                '</button>'
              ) : '') +
              // v2.45.16: ручное сопоставление со складом — для sale_product/свободного
              // ввода, когда автомат не нашёл совпадения. Открывает picker с поиском.
              ((!it.model_id && !it.component_id && (it.sale_product_id || !it.model_id)) ? (
                '<button class="spec-item-act-btn" style="color:#2563EB;" ' +
                  'title="Сопоставить со складом вручную" ' +
                  'onclick="openManualComponentPicker(' + contractId + ',' + it.id + ',' + JSON.stringify(it.sale_product_name || it.name || '').replace(/"/g,'&quot;') + ')">' +
                  '<i class="ti ti-link"></i>' +
                '</button>'
              ) : '') +
              // v2.45.208: QR у КАЖДОГО изделия (раньше — только у позиций в
              // резерве). Печать этикетки; скан QR открывает карточку позиции
              // (/c/{token}?item=ID). qty этикеток по кол-ву.
              ((typeof canPrintLabels === 'function' && canPrintLabels()) ? (
                '<button class="spec-item-act-btn" style="color:#0C4A6E;" ' +
                  'title="Печать QR-этикетки изделия (скан → карточка позиции)" ' +
                  'onclick="printComponentItemQr(' + contractId + ',' + it.id + ')">' +
                  '<i class="ti ti-qrcode"></i>' +
                '</button>'
              ) : '') +
              '<button class="spec-item-act-btn" title="Редактировать" onclick="startEditSpecItem(' + contractId + ',' + it.id + ')"><i class="ti ti-pencil"></i></button>' +
              '<button class="spec-item-act-btn danger" title="Удалить" onclick="deleteSpecItem(' + contractId + ',' + it.id + ')"><i class="ti ti-trash"></i></button>' +
            '</div>' : '') +
          '</div>' +
        '</div>';
      }
    });
    html += '</div>';
  } else if (!st.addingMode) {
    html += '<div class="spec-empty">Спецификация пока пуста. Добавьте позиции, которые поставляются по договору.</div>';
  }

  // Форма добавления новой позиции
  if (st.addingMode) {
    html += renderSpecForm(contractId, null);
  } else if (canEdit) {
    html += '<button class="spec-add-btn" onclick="startAddSpecItem(' + contractId + ')"><i class="ti ti-plus"></i> Добавить позицию</button>';
  }

  html += '</div>';
  container.innerHTML = html;
  container.style.display = '';

  // Фокус на поле name если форма открыта
  setTimeout(() => {
    const f = document.getElementById('spec-form-name');
    if (f) f.focus();
  }, 50);
}

function renderSpecForm(contractId, existing) {
  // existing = null для новой позиции, объект для редактирования
  const e = existing || { name: '', qty: 1, unit: 'шт.', model_id: null };
  const isEdit = !!existing;
  const formId = isEdit ? ('spec-form-edit-' + existing.id) : 'spec-form-new';

  // Если есть model_id — показываем имя модели как label
  let modelLabel = '';
  if (e.model_id && e.model_name) {
    const parts = [];
    if (e.model_article) parts.push(e.model_article);
    if (e.model_name) parts.push(e.model_name);
    modelLabel = parts.join(' · ');
  } else if (e.component_id && e.component_name) {
    // ЭТАП 37: комплектующее
    const parts = [];
    if (e.component_sku) parts.push(e.component_sku);
    parts.push(e.component_name);
    modelLabel = parts.join(' · ');
  } else if (e.sale_product_id && e.sale_product_name) {
    // ЭТАП 37: продажная позиция
    const parts = [];
    if (e.sale_product_nc_code) parts.push(e.sale_product_nc_code);
    parts.push(e.sale_product_name);
    modelLabel = parts.join(' · ');
  } else if (e.name) {
    modelLabel = e.name;
  }

  // ЭТАП 37: установить контекст формы из существующей позиции
  if (isEdit) {
    let kind = '', directionName = '', categoryName = '';
    if (e.model_id) {
      kind = 'model';
      directionName = e.model_direction_name || '';
    } else if (e.component_id) {
      kind = 'component';
      categoryName = e.component_category_name || '';
    } else if (e.sale_product_id) {
      kind = 'sale';
      categoryName = e.sale_product_category_name || '';
    }
    state._specFormCtx = { kind: kind, directionName: directionName, categoryName: categoryName };
  } else {
    state._specFormCtx = { kind: '', directionName: '', categoryName: '' };
  }

  let html = '<div class="spec-form" id="' + formId + '">';
  // Поле поиска модели
  html += '<div class="spec-form-field" style="grid-column: 1 / -1;">';
  html += '<label>Позиция (поиск по всей номенклатуре)<span style="color:var(--text-light); font-size:11px; font-weight:400; margin-left:6px;">модели · комплектующие · продажа</span> *</label>';
  html += '<input type="hidden" id="spec-form-model-id" value="' + (e.model_id || '') + '">';
  html += '<input type="hidden" id="spec-form-component-id" value="' + (e.component_id || '') + '">';
  html += '<input type="hidden" id="spec-form-sale-product-id" value="' + (e.sale_product_id || '') + '">';
  html += '<input type="hidden" id="spec-form-name" value="' + escapeHtml(e.name || '') + '">';
  html += '<div class="spec-search-wrap">';
  html += '<input type="text" id="spec-form-search" value="' + escapeHtml(modelLabel) +
          '" placeholder="Артикул, название или НС-код…" autocomplete="off" ' +
          'oninput="onSpecSearchInput(this.value)" onfocus="onSpecSearchInput(this.value)">';
  html += '<button class="spec-browse-btn" onclick="openNomPicker(' + contractId + ',' + (isEdit ? existing.id : 'null') + ')" title="Обзор номенклатуры" type="button"><i class="ti ti-layout-grid"></i></button>';
  html += '<div id="spec-search-results" class="spec-search-results" style="display:none;"></div>';
  html += '</div>';
  html += '</div>';
  // Кол-во + ед.изм.
  html += '<div class="spec-form-field"><label>Кол-во *</label>' +
          '<input type="number" id="spec-form-qty" value="' + (e.qty || 1) + '" min="0" step="0.01">' +
          '</div>';
  html += '<div class="spec-form-field" style="grid-column: 2 / -1;"><label>Ед.изм.</label>' +
          '<input type="text" id="spec-form-unit" value="' + escapeHtml(e.unit || 'шт.') + '" maxlength="30" list="spec-units">' +
          '<datalist id="spec-units">' +
            '<option value="шт.">' +
            '<option value="м">' +
            '<option value="м²">' +
            '<option value="кг">' +
            '<option value="т">' +
            '<option value="л">' +
            '<option value="компл.">' +
            '<option value="упак.">' +
          '</datalist>' +
          '</div>';
  // v2.45.199: к какой системе/объекту относится позиция (напр. AtomCold№24).
  // datalist — из уже введённых по этому договору тегов (удобно переиспользовать).
  const _existingSysTags = Array.from(new Set(((state._specByContract[contractId] || {}).items || [])
    .map(x => (x.system_tag || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru'));
  html += '<div class="spec-form-field" style="grid-column: 1 / -1;"><label>Относится к системе / объекту ' +
    '<span style="text-transform:none;color:var(--text-light);font-weight:400;">(напр. AtomCold№24 — необязательно)</span></label>' +
    '<input type="text" id="spec-form-system-tag" value="' + escapeHtml(e.system_tag || '') + '" ' +
    'placeholder="напр. AtomCold№24" maxlength="120" list="spec-system-tags">' +
    '<datalist id="spec-system-tags">' +
    _existingSysTags.map(t => '<option value="' + escapeHtml(t) + '">').join('') +
    '</datalist></div>';
  // ЭТАП 37: контейнер для условных полей Исполнение/IP
  html += '<div id="spec-form-conditional" style="grid-column: 1 / -1;">';
  html += _renderSpecConditionalFieldsHTML(e);
  html += '</div>';
  // v2.45.198: «закуп в другом городе, отгрузка сразу на объекте» + контакты/файл
  const altOn = !!e.alt_supply;
  html += '<div style="grid-column: 1 / -1; margin-top: 6px; border-top: 1px dashed var(--border); padding-top: 10px;">';
  html += '<label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:600; color:var(--text-dark);">' +
    '<input type="checkbox" id="spec-form-alt-supply"' + (altOn ? ' checked' : '') + ' onchange="_toggleSpecAlt()" style="width:auto;flex-shrink:0;">' +
    '<span><i class="ti ti-truck-delivery" style="vertical-align:-2px;color:#B45309;"></i> Закуп в другом городе (отгрузка сразу на объекте)</span>' +
    '</label>';
  html += '<div id="spec-form-alt-details" style="' + (altOn ? '' : 'display:none;') + 'margin-top:10px;">';
  html += '<div class="spec-form-row-2">';
  html += '<div class="spec-form-field"><label>Город закупа</label>' +
    '<input type="text" id="spec-form-alt-city" value="' + escapeHtml(e.alt_supply_city || '') + '" placeholder="напр. Новосибирск" maxlength="120"></div>';
  html += '<div class="spec-form-field"><label>Телефон</label>' +
    '<input type="text" id="spec-form-alt-phone" value="' + escapeHtml(e.alt_supply_phone || '') + '" placeholder="+7…" maxlength="60"></div>';
  html += '</div>';
  html += '<div class="spec-form-field" style="margin-top:8px;"><label>Комментарий</label>' +
    '<textarea id="spec-form-alt-comment" rows="2" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;resize:vertical;" placeholder="поставщик, условия, что заказать…">' + escapeHtml(e.alt_supply_comment || '') + '</textarea></div>';
  html += '<div class="spec-form-field" style="margin-top:8px;"><label>Файл (счёт / спека / фото — до 25 МБ)</label>' +
    '<input type="file" id="spec-form-alt-file" onchange="_onSpecAltFilePick(this)">';
  if (isEdit && e.alt_supply_file_key) {
    html += '<div style="font-size:12px;margin-top:4px;">Прикреплён: ' +
      '<a href="#" onclick="_openSpecAltFile(' + existing.id + ');return false;" style="color:var(--brand);">' +
      escapeHtml(e.alt_supply_file_name || 'файл') + '</a></div>';
  }
  html += '</div>';
  html += '</div>';
  html += '</div>';
  // Кнопки
  html += '<div class="spec-form-row-2">';
  html += '<div></div>';
  html += '<div class="spec-form-actions">';
  html += '<button onclick="cancelSpecForm(' + contractId + ')">Отмена</button>';
  html += '<button class="primary" onclick="submitSpecForm(' + contractId + ',' + (isEdit ? existing.id : 'null') + ')"><i class="ti ti-check"></i> ' + (isEdit ? 'Сохранить' : 'Добавить')  + '</button>';
  html += '</div>';
  html += '</div>';
  html += '</div>';
  return html;
}

// ЭТАП 37: проверка — нужно ли показывать поле «Исполнение» для текущего контекста
function _specCtxNeedsExecution() {
  const ctx = state._specFormCtx || {};
  const dir = (ctx.directionName || '').toLowerCase();
  const cat = (ctx.categoryName || '').toLowerCase();
  // Воздухоохладители / Увлажнение / Щиты управления — все три триггерят поле «Исполнение»
  const triggers = ['воздухоохладит', 'увлажн', 'щит'];
  return triggers.some(t => dir.includes(t) || cat.includes(t));
}

// ЭТАП 37: проверка — нужно ли показывать поле «Влагозащита» (только для щитов управления)
function _specCtxNeedsIp() {
  const ctx = state._specFormCtx || {};
  const dir = (ctx.directionName || '').toLowerCase();
  const cat = (ctx.categoryName || '').toLowerCase();
  return dir.includes('щит') || cat.includes('щит');
}

// ЭТАП 37: HTML для условных полей (Исполнение + Влагозащита)
function _renderSpecConditionalFieldsHTML(existing) {
  const e = existing || {};
  let html = '';
  const needExec = _specCtxNeedsExecution();
  const needIp = _specCtxNeedsIp();
  if (!needExec && !needIp) {
    return '';  // ничего не показываем — обычная категория
  }
  html += '<div class="spec-form-row-2" style="margin-top: 8px;">';
  // Исполнение (всегда если needExec)
  if (needExec) {
    const execType = e.execution_type || '';
    html += '<div class="spec-form-field">';
    html += '<label>Исполнение</label>';
    html += '<div class="radio-chips" style="display:flex; gap:6px;">';
    html += '<button type="button" class="' + (execType === 'standard' ? 'selected' : '') + '" onclick="_setSpecExecutionType(\'standard\')">Обычное</button>';
    html += '<button type="button" class="' + (execType === 'stainless' ? 'selected' : '') + '" onclick="_setSpecExecutionType(\'stainless\')">Нержавейка</button>';
    html += '</div>';
    html += '<input type="hidden" id="spec-form-execution-type" value="' + escapeHtml(execType) + '">';
    html += '</div>';
  }
  // Влагозащита (только щиты)
  if (needIp) {
    const ip = e.ip_rating || '';
    html += '<div class="spec-form-field">';
    html += '<label>Влагозащита</label>';
    html += '<select id="spec-form-ip-rating">';
    html += '<option value="">— не указана —</option>';
    ['IP44', 'IP54', 'IP65', 'IP66', 'IP67'].forEach(v => {
      html += '<option value="' + v + '"' + (ip === v ? ' selected' : '') + '>' + v + '</option>';
    });
    html += '</select>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// Перерисовать условные поля после смены позиции в picker
function _rerenderSpecConditionalFields() {
  const container = document.getElementById('spec-form-conditional');
  if (!container) return;
  container.innerHTML = _renderSpecConditionalFieldsHTML({});
}

// Хелпер: установить execution_type (радио-чипы)
function _setSpecExecutionType(value) {
  const hidden = document.getElementById('spec-form-execution-type');
  if (hidden) hidden.value = value;
  // Перерисуем кнопки чтобы обновить selected
  const container = document.getElementById('spec-form-conditional');
  if (container) {
    // Просто обновляем data в DOM, а класс — через find
    const buttons = container.querySelectorAll('.radio-chips button');
    buttons.forEach(btn => {
      const isMatch = btn.textContent.toLowerCase().includes(value === 'standard' ? 'обыч' : 'нержав');
      btn.classList.toggle('selected', isMatch);
    });
  }
}

// Поиск моделей для autocomplete (с дебаунсом)
state._specSearchTimer = null;
state._specSearchCache = {};

async function onSpecSearchInput(query) {
  const results = document.getElementById('spec-search-results');
  if (!results) return;

  const q = (query || '').trim();
  // Если очистили поле — сбрасываем выбор
  if (!q) {
    const mid = document.getElementById('spec-form-model-id');
    const cid = document.getElementById('spec-form-component-id');
    const sid = document.getElementById('spec-form-sale-product-id');
    const nm = document.getElementById('spec-form-name');
    if (mid) mid.value = '';
    if (cid) cid.value = '';
    if (sid) sid.value = '';
    if (nm) nm.value = '';
    results.style.display = 'none';
    return;
  }

  // Дебаунс 250мс
  clearTimeout(state._specSearchTimer);
  state._specSearchTimer = setTimeout(async () => {
    let items;
    if (state._specSearchCache[q]) {
      items = state._specSearchCache[q];
    } else {
      try {
        // v2.20.0: унифицированный поиск (модели + комплектующие + продажная)
        const d = await apiGet('/api/nomenclature/search?q=' + encodeURIComponent(q) + '&limit=20');
        items = (d && d.items) || [];
        state._specSearchCache[q] = items;
      } catch (e) {
        results.innerHTML = '<div class="spec-search-empty">Ошибка загрузки</div>';
        results.style.display = 'block';
        return;
      }
    }

    if (!items.length) {
      results.innerHTML = '<div class="spec-search-empty">Ничего не найдено. Можно ввести название вручную и нажать «Добавить» — сохранится как свободный ввод.</div>';
      results.style.display = 'block';
      return;
    }

    // v2.20.0: рендерим с бейджем источника (модель / компл. / продажа)
    let html = '';
    items.slice(0, 24).forEach(it => {
      const sourceBadge = _specSearchSourceBadge(it.source);
      const labelHtml = '<b>' + escapeHtml(it.label || '—') + '</b>';
      const sublabel = it.sublabel ? '<div class="spec-search-item-meta">' + escapeHtml(it.sublabel) + '</div>' : '';
      const itemPayload = JSON.stringify({
        source: it.source,
        model_id: it.model_id || null,
        component_id: it.component_id || null,
        sale_product_id: it.sale_product_id || null,
        label: it.label || '',
        exec_mode: it.exec_mode || null,
        exec_fixed: it.exec_fixed || null,
        exec_label_st: it.exec_label_st || null,
        exec_label_ne: it.exec_label_ne || null,
        needs_ip: !!it.needs_ip,
        direction_name: it.direction_name || '',
        category_name: it.category_name || '',
        unit: it.unit || 'шт.',
      }).replace(/"/g, '&quot;');
      html += '<div class="spec-search-item" onclick="selectUnifiedSpec(&quot;' + itemPayload.replace(/&quot;/g, '\\&quot;') + '&quot;)">' +
        '<div class="spec-search-item-title">' + labelHtml + sourceBadge + '</div>' +
        sublabel +
      '</div>';
    });
    results.innerHTML = html;
    results.style.display = 'block';
  }, 250);
}

// v2.20.0: бейдж источника в выпадающем списке поиска
function _specSearchSourceBadge(source) {
  if (source === 'model')        return ' <span class="ss-source ss-model"><i class="ti ti-tool"></i>модель</span>';
  if (source === 'component')    return ' <span class="ss-source ss-component"><i class="ti ti-package"></i>компл.</span>';
  if (source === 'sale_product') return ' <span class="ss-source ss-sale"><i class="ti ti-shopping-cart"></i>продажа</span>';
  return '';
}

// v2.20.0: универсальный обработчик выбора из унифицированного поиска
function selectUnifiedSpec(payloadStr) {
  let p;
  try {
    // Декодируем дважды экранированный JSON
    const json = String(payloadStr).replace(/\\&quot;/g, '"').replace(/&quot;/g, '"');
    p = JSON.parse(json);
  } catch (e) {
    showToast('Ошибка выбора позиции', 'error');
    return;
  }
  const mid = document.getElementById('spec-form-model-id');
  const cid = document.getElementById('spec-form-component-id');
  const sid = document.getElementById('spec-form-sale-product-id');
  const nm = document.getElementById('spec-form-name');
  const input = document.getElementById('spec-form-search');
  const unitInput = document.getElementById('spec-form-unit');
  const results = document.getElementById('spec-search-results');

  // Сбрасываем все три id
  if (mid) mid.value = '';
  if (cid) cid.value = '';
  if (sid) sid.value = '';

  // Устанавливаем нужный id и контекст
  if (p.source === 'model' && p.model_id) {
    if (mid) mid.value = String(p.model_id);
    state._specFormCtx = {
      kind: 'model',
      directionName: p.direction_name || '',
      categoryName: p.category_name || '',
    };
  } else if (p.source === 'component' && p.component_id) {
    if (cid) cid.value = String(p.component_id);
    state._specFormCtx = { kind: 'component', directionName: '', categoryName: p.category_name || '' };
  } else if (p.source === 'sale_product' && p.sale_product_id) {
    if (sid) sid.value = String(p.sale_product_id);
    state._specFormCtx = { kind: 'sale', directionName: '', categoryName: p.category_name || '' };
  }
  if (nm) nm.value = p.label || '';
  if (input) input.value = p.label || '';
  if (unitInput && p.unit && !unitInput.value) unitInput.value = p.unit;

  if (results) results.style.display = 'none';

  // Перерисуем условные поля (Исполнение/IP) под новый контекст
  const cond = document.getElementById('spec-form-conditional');
  if (cond && typeof _renderSpecConditionalFieldsHTML === 'function') {
    cond.innerHTML = _renderSpecConditionalFieldsHTML({
      execution_type: null, ip_rating: null,
      exec_mode: p.exec_mode, exec_fixed: p.exec_fixed,
      exec_label_st: p.exec_label_st, exec_label_ne: p.exec_label_ne,
      needs_ip: p.needs_ip,
    });
  }
}

function selectSpecModel(modelId, label) {
  const mid = document.getElementById('spec-form-model-id');
  const nm = document.getElementById('spec-form-name');
  const search = document.getElementById('spec-form-search');
  const results = document.getElementById('spec-search-results');
  if (mid) mid.value = modelId;
  if (nm) nm.value = label;
  if (search) search.value = label;
  if (results) results.style.display = 'none';
  // Фокус на поле количества
  const qty = document.getElementById('spec-form-qty');
  if (qty) { qty.focus(); qty.select(); }
}

function startAddSpecItem(contractId) {
  if (!state._specByContract[contractId]) {
    state._specByContract[contractId] = { items: [], total: 0, addingMode: false, editingId: null };
  }
  state._specByContract[contractId].addingMode = true;
  state._specByContract[contractId].editingId = null;
  renderContractItemsBlock(contractId);
}

function startEditSpecItem(contractId, itemId) {
  if (!state._specByContract[contractId]) return;
  state._specByContract[contractId].editingId = itemId;
  state._specByContract[contractId].addingMode = false;
  renderContractItemsBlock(contractId);
}

function cancelSpecForm(contractId) {
  if (!state._specByContract[contractId]) return;
  state._specByContract[contractId].addingMode = false;
  state._specByContract[contractId].editingId = null;
  renderContractItemsBlock(contractId);
}

async function submitSpecForm(contractId, itemId) {
  const modelId = parseInt(document.getElementById('spec-form-model-id').value) || null;
  const componentId = parseInt(document.getElementById('spec-form-component-id').value) || null;
  const saleProductId = parseInt(document.getElementById('spec-form-sale-product-id').value) || null;
  let name = (document.getElementById('spec-form-name').value || '').trim();
  // v2.45.204: свободный ввод вручную — если из каталога ничего не выбрано,
  // берём то, что вписали в поле поиска (для закупа в другом городе и т.п.).
  if (!modelId && !componentId && !saleProductId && !name) {
    const _searchEl = document.getElementById('spec-form-search');
    name = ((_searchEl && _searchEl.value) || '').trim();
  }
  if (!modelId && !componentId && !saleProductId && !name) {
    showToast('Выберите позицию из каталога или впишите название вручную', 'error');
    return;
  }
  // ЭТАП 37: условные поля
  const execEl = document.getElementById('spec-form-execution-type');
  const ipEl = document.getElementById('spec-form-ip-rating');
  const payload = {
    model_id: modelId,
    component_id: componentId,
    sale_product_id: saleProductId,
    name: name,
    qty: parseFloat(document.getElementById('spec-form-qty').value) || 0,
    unit: (document.getElementById('spec-form-unit').value || 'шт.').trim() || 'шт.',
    // execution_type / ip_rating — отправляем всегда, чтобы PATCH мог очистить
    execution_type: execEl ? (execEl.value || '') : '',
    ip_rating: ipEl ? (ipEl.value || '') : '',
  };
  // v2.45.198: закуп в другом городе
  const altCb = document.getElementById('spec-form-alt-supply');
  const altOn = !!(altCb && altCb.checked);
  payload.alt_supply = altOn ? 1 : 0;
  payload.alt_supply_city = altOn ? ((document.getElementById('spec-form-alt-city') || {}).value || '').trim() : '';
  payload.alt_supply_phone = altOn ? ((document.getElementById('spec-form-alt-phone') || {}).value || '').trim() : '';
  payload.alt_supply_comment = altOn ? ((document.getElementById('spec-form-alt-comment') || {}).value || '').trim() : '';
  // v2.45.199: система/объект
  payload.system_tag = ((document.getElementById('spec-form-system-tag') || {}).value || '').trim();

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    let r;
    if (itemId) {
      // Update
      r = await fetch(API_BASE + '/api/contracts/items/' + itemId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
    } else {
      // Create
      r = await fetch(API_BASE + '/api/contracts/' + contractId + '/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
    }
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось сохранить', 'error');
      return;
    }
    // v2.45.198: если выбран файл к «закупу в другом городе» — грузим после сохранения
    const _saved = await r.json().catch(() => ({}));
    const _savedId = itemId || (_saved && _saved.id);
    if (altOn && _savedId && state._specAltFile) {
      try {
        const _fd = new FormData();
        _fd.append('file', state._specAltFile);
        await fetch(API_BASE + '/api/contracts/items/' + _savedId + '/alt-file', {
          method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: _fd,
        });
      } catch (e) { /* файл не критичен */ }
    }
    state._specAltFile = null;
    showToast(itemId ? 'Позиция обновлена' : 'Позиция добавлена', 'success');
    // Сбрасываем режимы и перезагружаем блок
    state._specByContract[contractId].addingMode = false;
    state._specByContract[contractId].editingId = null;
    loadContractItemsBlock(contractId);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// v2.45.198: «закуп в другом городе» — тоггл деталей, выбор файла, открытие файла
function _toggleSpecAlt() {
  const cb = document.getElementById('spec-form-alt-supply');
  const det = document.getElementById('spec-form-alt-details');
  if (det) det.style.display = (cb && cb.checked) ? '' : 'none';
}
function _onSpecAltFilePick(input) {
  state._specAltFile = (input && input.files && input.files[0]) || null;
}
async function _openSpecAltFile(itemId) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/contracts/items/' + itemId + '/alt-file', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) { showToast('Файл не найден', 'error'); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { showToast('Ошибка открытия файла', 'error'); }
}

async function deleteSpecItem(contractId, itemId) {
  if (!confirm('Удалить позицию из спецификации?')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/contracts/items/' + itemId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      showToast('Не удалось удалить', 'error');
      return;
    }
    showToast('Удалено', 'success');
    loadContractItemsBlock(contractId);
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

// ============ ЭТАП 27.4 (v2.21.4): СКАЧИВАНИЕ СПЕЦИФИКАЦИИ ============

async function downloadContractSpecDocx(contractId) {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showToast('Сессия истекла, войдите заново', 'error');
    return;
  }
  showToast('Готовим Word…', 'success');
  try {
    const r = await fetch(API_BASE + '/api/contracts/' + contractId + '/spec/docx', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      let msg = 'Не удалось получить Word';
      try { const d = await r.json(); msg = d.message || msg; } catch (e) {}
      showToast(msg, 'error');
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cd = r.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="([^"]+)"/);
    a.download = match ? match[1] : 'Спецификация.docx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    showToast('Ошибка соединения: ' + String(e), 'error');
  }
}

async function downloadContractSpecPdf(contractId) {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showToast('Сессия истекла, войдите заново', 'error');
    return;
  }
  showToast('Готовим PDF…', 'success');
  try {
    const r = await fetch(API_BASE + '/api/contracts/' + contractId + '/spec/pdf?base=' + encodeURIComponent(window.location.origin), {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      let msg = 'Не удалось получить PDF';
      try { const d = await r.json(); msg = d.message || msg; } catch (e) {}
      showToast(msg, 'error');
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    // Открываем PDF в новой вкладке (мобильный браузер сам предложит скачать)
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    showToast('Ошибка соединения: ' + String(e), 'error');
  }
}

// ============ ЭТАП 27.2: МОДАЛКА ВЫБОРА НОМЕНКЛАТУРЫ ============

state._nomPicker = {
  contractId: null,
  itemId: null,
  tab: 'production',          // 'production' | 'sale' | 'components'
  productionData: null,       // {models, directions} — кэш
  saleData: null,             // {products, categories} — кэш
  componentsData: null,       // {components, categories} — кэш (ЭТАП 37)
  filter: '',
  openGroups: {},             // ключ "tab:groupId" → bool
};

function openNomPicker(contractId, itemId) {
  state._nomPicker.contractId = contractId;
  state._nomPicker.itemId = itemId;
  state._nomPicker.tab = 'production';
  state._nomPicker.filter = '';
  state._nomPicker.openGroups = {};
  // v2.45.210: сбрасываем кэш — чтобы свежесозданные позиции (модели/товары/
  // комплектующие) сразу появлялись в пикере, а не после перезагрузки страницы.
  state._nomPicker.productionData = null;
  state._nomPicker.saleData = null;
  state._nomPicker.componentsData = null;

  const ov = document.getElementById('nom-picker-overlay');
  if (ov) ov.classList.add('visible');
  document.body.style.overflow = 'hidden';

  // Сброс поискового поля
  const si = document.getElementById('nom-picker-search-input');
  if (si) si.value = '';

  // Активируем нужный таб визуально
  document.querySelectorAll('.nom-picker-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector('.nom-picker-tab[data-nom-tab="production"]');
  if (activeTab) activeTab.classList.add('active');

  loadNomTab('production');
}

function closeNomPicker() {
  const ov = document.getElementById('nom-picker-overlay');
  if (ov) ov.classList.remove('visible');
  document.body.style.overflow = '';
}

function switchNomTab(tab) {
  if (state._nomPicker.tab === tab) return;
  state._nomPicker.tab = tab;
  state._nomPicker.openGroups = {};
  document.querySelectorAll('.nom-picker-tab').forEach(t => t.classList.remove('active'));
  const btn = document.querySelector('.nom-picker-tab[data-nom-tab="' + tab + '"]');
  if (btn) btn.classList.add('active');
  loadNomTab(tab);
}

async function loadNomTab(tab) {
  const body = document.getElementById('nom-picker-body');
  if (!body) return;

  if (tab === 'production') {
    if (!state._nomPicker.productionData) {
      body.innerHTML = '<div class="nom-loading">Загружаем номенклатуру…</div>';
      try {
        const d = await apiGet('/api/models');
        state._nomPicker.productionData = {
          models: (d && d.models) || [],
          directions: (d && d.directions) || [],
        };
      } catch (e) {
        body.innerHTML = '<div class="nom-empty">Ошибка загрузки: ' + escapeHtml(String(e)) + '</div>';
        return;
      }
    }
    renderProductionTree();
  } else if (tab === 'sale') {
    if (!state._nomPicker.saleData) {
      body.innerHTML = '<div class="nom-loading">Загружаем продажную номенклатуру…</div>';
      try {
        const [pr, cat] = await Promise.all([
          apiGet('/api/sale-products?include_inactive=false'),
          apiGet('/api/sale-categories'),
        ]);
        state._nomPicker.saleData = {
          products: (pr && pr.products) || [],
          categories: (cat && cat.categories) || cat || [],
        };
      } catch (e) {
        body.innerHTML = '<div class="nom-empty">Ошибка загрузки: ' + escapeHtml(String(e)) + '</div>';
        return;
      }
    }
    renderSaleTree();
  } else if (tab === 'components') {
    // ЭТАП 37: вкладка комплектующих
    if (!state._nomPicker.componentsData) {
      body.innerHTML = '<div class="nom-loading">Загружаем комплектующие…</div>';
      try {
        const [comps, cats] = await Promise.all([
          apiGet('/api/components'),
          apiGet('/api/components/categories'),
        ]);
        state._nomPicker.componentsData = {
          components: (comps && comps.components) || [],
          categories: (cats && cats.categories) || cats || [],
        };
      } catch (e) {
        body.innerHTML = '<div class="nom-empty">Ошибка загрузки: ' + escapeHtml(String(e)) + '</div>';
        return;
      }
    }
    renderComponentsTree();
  }
}

function onNomPickerFilter(value) {
  state._nomPicker.filter = (value || '').toLowerCase().trim();
  if (state._nomPicker.tab === 'production') renderProductionTree();
  else if (state._nomPicker.tab === 'sale') renderSaleTree();
  else if (state._nomPicker.tab === 'components') renderComponentsTree();
}

// v2.45.210: позиция-модель в дереве пикера производства (кликабельна для выбора)
function _prodPickItem(m, dirName) {
  const article = m.article || '';
  const name = m.name || '';
  const extra = m.extra || '';
  const label = (article ? article + ' · ' : '') + name;
  const labelJson = JSON.stringify(label).replace(/"/g, '&quot;');
  const dirJson = JSON.stringify(dirName || '').replace(/"/g, '&quot;');
  return '<div class="sp-tree-item" onclick="pickNomModel(' + m.id + ',' + labelJson + ',' + dirJson + ')">' +
    '<div class="sp-tree-item-main">' +
      '<div class="sp-tree-item-name">' + (article ? '<b>' + escapeHtml(article) + '</b> ' : '') + escapeHtml(name) + '</div>' +
      (extra ? '<div class="sp-tree-item-meta">' + escapeHtml(extra) + '</div>' : '') +
    '</div>' +
  '</div>';
}

// v2.45.210: дерево производства по разделам → подразделам (как каталог), а не
// плоским списком. Те же .sp-tree-* стили, что и на вкладке «Продажи».
function renderProductionTree() {
  const body = document.getElementById('nom-picker-body');
  if (!body) return;
  const d = state._nomPicker.productionData;
  if (!d) return;
  const filter = state._nomPicker.filter;
  const list = d.models.filter(m => {
    if (!m.is_active) return false;
    if (!filter) return true;
    return (m.name || '').toLowerCase().includes(filter) ||
           (m.article || '').toLowerCase().includes(filter) ||
           (m.extra || '').toLowerCase().includes(filter);
  });
  if (!list.length) {
    body.innerHTML = '<div class="nom-empty"><i class="ti ti-search-off" style="font-size:24px; display:block; margin-bottom:6px;"></i>' +
      (filter ? 'По запросу ничего не найдено' : 'Номенклатура пуста') + '</div>';
    return;
  }
  const og = state._nomPicker.openGroups;
  const autoOpen = !!filter;
  const byDir = {};
  list.forEach(m => { const id = m.direction_id || 0; (byDir[id] = byDir[id] || []).push(m); });

  function _renderDir(dirId, dirName, models) {
    if (!models.length) return '';
    const dKey = 'pd:' + dirId;
    const dOpen = autoOpen || !!og[dKey];
    let h = '<div class="sp-tree-group">' +
      '<button type="button" class="sp-tree-toggle group' + (dOpen ? ' open' : '') + '" onclick="toggleNomGroup(\'' + dKey + '\')">' +
        '<i class="ti ti-chevron-right sp-tree-chev"></i>' +
        '<i class="ti ti-folder" style="font-size:16px;"></i>' +
        '<span>' + escapeHtml(dirName) + '</span>' +
        '<span class="sp-tree-count">' + models.length + '</span>' +
      '</button>';
    if (dOpen) {
      h += '<div class="sp-tree-body">';
      const bySg = {}; const noSg = [];
      models.forEach(m => {
        if (m.subgroup_id) {
          const s = String(m.subgroup_id);
          if (!bySg[s]) bySg[s] = { id: m.subgroup_id, name: m.subgroup_name || ('Подгруппа #' + s), items: [] };
          bySg[s].items.push(m);
        } else noSg.push(m);
      });
      if (noSg.length) {
        h += '<div class="sp-tree-items">';
        noSg.forEach(m => { h += _prodPickItem(m, dirName); });
        h += '</div>';
      }
      Object.keys(bySg).sort((a, b) => (bySg[a].name || '').localeCompare(bySg[b].name || '', 'ru')).forEach(s => {
        const sg = bySg[s];
        const sKey = 'psg:' + dirId + ':' + s;
        const sOpen = autoOpen || !!og[sKey];
        h += '<div class="sp-tree-subgroup">' +
          '<button type="button" class="sp-tree-toggle subgroup' + (sOpen ? ' open' : '') + '" onclick="toggleNomGroup(\'' + sKey + '\')">' +
            '<i class="ti ti-chevron-right sp-tree-chev"></i>' +
            '<span>' + escapeHtml(sg.name) + '</span>' +
            '<span class="sp-tree-count subgroup">' + sg.items.length + '</span>' +
          '</button>';
        if (sOpen) {
          h += '<div class="sp-tree-items">';
          sg.items.forEach(m => { h += _prodPickItem(m, dirName); });
          h += '</div>';
        }
        h += '</div>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  let html = '<div style="padding:4px 0 12px;">';
  (d.directions || []).forEach(dir => { html += _renderDir(dir.id, dir.name, byDir[dir.id] || []); });
  if ((byDir[0] || []).length) html += _renderDir(0, 'Без направления', byDir[0]);
  html += '</div>';
  body.innerHTML = html;
}

// v2.45.189: модалка «Выбор позиции» рендерится так же, как справочник
// «Продажная номенклатура» — по реальной иерархии каталога
// (group_name → subgroup_name), а не по category_id с дроблением на «серии».
// Спокойно открываешь группу, потом подгруппу — и выбираешь. Используем те же
// .sp-tree-* стили, что и на странице справочника.
// v2.45.192: краткое превью характеристик прямо в списке выбора — чтобы
// не уходить смотреть характеристики, а сравнивать и выбирать на месте
// (например, электроприводы по крутящему моменту). Показываем до 6 непустых.
function _salePickSpecsPreview(specs) {
  if (!specs || typeof specs !== 'object') return '';
  const keys = Object.keys(specs).filter(k => {
    const v = specs[k];
    return v !== null && v !== undefined && String(v).trim() !== '';
  });
  if (!keys.length) return '';
  const MAX = 6;
  const shown = keys.slice(0, MAX);
  let s = shown.map(k =>
    escapeHtml(k) + ': <b style="color:var(--text);font-weight:600;">' + escapeHtml(String(specs[k])) + '</b>'
  ).join(' · ');
  if (keys.length > shown.length) s += ' · …';
  return s;
}
function _salePickItemHtml(p, catName) {
  const article = p.article || '';
  const name = p.name || '';
  const unit = p.unit_name || p.unit || '';
  const nc = p.nc_code || '';
  const label = (article ? article + ' · ' : '') + name;
  const labelJson = JSON.stringify(label).replace(/"/g, '&quot;');
  const unitJson = JSON.stringify(unit || 'шт.').replace(/"/g, '&quot;');
  const catJson = JSON.stringify(catName || '').replace(/"/g, '&quot;');
  const specsLine = _salePickSpecsPreview(p.specs);
  return '<div class="sp-tree-item" onclick="pickNomSaleProduct(' + labelJson + ',' + unitJson + ',' + p.id + ',' + catJson + ')">' +
    '<div class="sp-tree-item-main">' +
      '<div class="sp-tree-item-name">' + (article ? '<b>' + escapeHtml(article) + '</b> ' : '') + escapeHtml(name) + '</div>' +
      '<div class="sp-tree-item-meta">' +
        (nc ? '<span style="font-family:monospace;font-size:11px;">' + escapeHtml(nc) + '</span> ' : '') +
        (unit ? 'ед.изм.: ' + escapeHtml(unit) : '') +
      '</div>' +
      (specsLine ? '<div class="sp-pick-specs" style="font-size:11.5px; color:var(--text-light); margin-top:3px; line-height:1.45;">' + specsLine + '</div>' : '') +
    '</div>' +
  '</div>';
}
function _renderSalePickTree(list, autoOpen, catNameById) {
  // group_name → subgroup_name → товары (как на странице «Продажная номенклатура»)
  const tree = {};
  list.forEach(p => {
    const g = p.group_name || p.category_name || (catNameById[p.category_id] || '') || '(без группы)';
    const sg = p.subgroup_name || '(без подгруппы)';
    if (!tree[g]) tree[g] = {};
    if (!tree[g][sg]) tree[g][sg] = [];
    tree[g][sg].push(p);
  });
  const og = state._nomPicker.openGroups;
  const groupNames = Object.keys(tree).sort((a, b) => a.localeCompare(b, 'ru'));
  let html = '<div style="padding: 4px 0 12px;">';
  groupNames.forEach(gName => {
    const subgroups = tree[gName];
    const subNames = Object.keys(subgroups).sort((a, b) => a.localeCompare(b, 'ru'));
    const groupCount = subNames.reduce((acc, sg) => acc + subgroups[sg].length, 0);
    const gKey = 'spg:' + gName;
    const gOpen = autoOpen || !!og[gKey];
    // Если у группы только «(без подгруппы)» — показываем товары сразу под ней
    const flatOnly = subNames.length === 1 && subNames[0] === '(без подгруппы)';
    html += '<div class="sp-tree-group">' +
      '<button type="button" class="sp-tree-toggle group' + (gOpen ? ' open' : '') + '" ' +
        'onclick="toggleNomGroup(\'' + gKey.replace(/'/g, "\\'") + '\')">' +
        '<i class="ti ti-chevron-right sp-tree-chev"></i>' +
        '<i class="ti ti-folder" style="font-size:16px;"></i>' +
        '<span>' + escapeHtml(gName) + '</span>' +
        '<span class="sp-tree-count">' + groupCount + '</span>' +
      '</button>';
    if (gOpen) {
      html += '<div class="sp-tree-body">';
      if (flatOnly) {
        html += '<div class="sp-tree-items">';
        subgroups['(без подгруппы)'].forEach(p => { html += _salePickItemHtml(p, p.category_name || catNameById[p.category_id] || ''); });
        html += '</div>';
      } else {
        subNames.forEach(sgName => {
          const items = subgroups[sgName];
          const sgKey = 'spsg:' + gName + '||' + sgName;
          const sgOpen = autoOpen || !!og[sgKey];
          html += '<div class="sp-tree-subgroup">' +
            '<button type="button" class="sp-tree-toggle subgroup' + (sgOpen ? ' open' : '') + '" ' +
              'onclick="toggleNomGroup(\'' + sgKey.replace(/'/g, "\\'") + '\')">' +
              '<i class="ti ti-chevron-right sp-tree-chev"></i>' +
              '<span>' + escapeHtml(sgName) + '</span>' +
              '<span class="sp-tree-count subgroup">' + items.length + '</span>' +
            '</button>';
          if (sgOpen) {
            html += '<div class="sp-tree-items">';
            items.forEach(p => { html += _salePickItemHtml(p, p.category_name || catNameById[p.category_id] || ''); });
            html += '</div>';
          }
          html += '</div>';
        });
      }
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function renderSaleTree() {
  const body = document.getElementById('nom-picker-body');
  if (!body) return;
  const d = state._nomPicker.saleData;
  if (!d) return;

  const filter = state._nomPicker.filter;
  const list = d.products.filter(p => {
    if (!filter) return true;
    return (p.name || '').toLowerCase().includes(filter) ||
           (p.article || '').toLowerCase().includes(filter) ||
           (p.description || '').toLowerCase().includes(filter);
  });

  if (!list.length) {
    body.innerHTML = '<div class="nom-empty"><i class="ti ti-search-off" style="font-size:24px; display:block; margin-bottom:6px;"></i>' +
      (filter ? 'По запросу ничего не найдено' : 'Продажная номенклатура пуста') + '</div>';
    return;
  }

  // Карта category_id → имя (на случай, если у позиции нет group_name)
  const catNameById = {};
  (d.categories || []).forEach(c => { catNameById[c.id] = c.name; });

  // При поиске — раскрываем всё, иначе всё свёрнуто (спокойный просмотр)
  body.innerHTML = _renderSalePickTree(list, !!filter, catNameById);
}

function toggleNomGroup(key) {
  state._nomPicker.openGroups[key] = !state._nomPicker.openGroups[key];
  if (state._nomPicker.tab === 'production') renderProductionTree();
  else if (state._nomPicker.tab === 'sale') renderSaleTree();
  else if (state._nomPicker.tab === 'components') renderComponentsTree();
}

// Выбор модели из производства — заполняет model_id и name + сохраняет direction
function pickNomModel(modelId, label, directionName) {
  const mid = document.getElementById('spec-form-model-id');
  const nm = document.getElementById('spec-form-name');
  const search = document.getElementById('spec-form-search');
  if (mid) mid.value = modelId;
  if (nm) nm.value = label;
  if (search) search.value = label;
  // Очистка прочих связей
  const cid = document.getElementById('spec-form-component-id');
  const spid = document.getElementById('spec-form-sale-product-id');
  if (cid) cid.value = '';
  if (spid) spid.value = '';
  // ЭТАП 37: сохранить direction для условного рендера полей
  state._specFormCtx = {
    kind: 'model',
    directionName: directionName || '',
    categoryName: '',
  };
  _rerenderSpecConditionalFields();
  const results = document.getElementById('spec-search-results');
  if (results) results.style.display = 'none';
  closeNomPicker();
  // Фокус на количество
  const qty = document.getElementById('spec-form-qty');
  if (qty) { qty.focus(); qty.select(); }
}

// Выбор продажного товара — заполняет sale_product_id + name (без model_id) + подставляет unit
function pickNomSaleProduct(label, unit, saleProductId, categoryName) {
  const mid = document.getElementById('spec-form-model-id');
  const nm = document.getElementById('spec-form-name');
  const search = document.getElementById('spec-form-search');
  const unitEl = document.getElementById('spec-form-unit');
  const spid = document.getElementById('spec-form-sale-product-id');
  const cid = document.getElementById('spec-form-component-id');
  if (mid) mid.value = '';   // нет model_id для sale-products
  if (cid) cid.value = '';   // нет component_id
  if (spid) spid.value = saleProductId || '';
  if (nm) nm.value = label;
  if (search) search.value = label;
  if (unitEl && unit) unitEl.value = unit;
  // ЭТАП 37: сохранить category для условного рендера полей
  state._specFormCtx = {
    kind: 'sale',
    directionName: '',
    categoryName: categoryName || '',
  };
  _rerenderSpecConditionalFields();
  const results = document.getElementById('spec-search-results');
  if (results) results.style.display = 'none';
  closeNomPicker();
  const qty = document.getElementById('spec-form-qty');
  if (qty) { qty.focus(); qty.select(); }
}

// ЭТАП 37: выбор комплектующего — заполняет component_id + name + unit
function pickNomComponent(componentId, label, unit, categoryName) {
  const mid = document.getElementById('spec-form-model-id');
  const nm = document.getElementById('spec-form-name');
  const search = document.getElementById('spec-form-search');
  const unitEl = document.getElementById('spec-form-unit');
  const cid = document.getElementById('spec-form-component-id');
  const spid = document.getElementById('spec-form-sale-product-id');
  if (mid) mid.value = '';
  if (spid) spid.value = '';
  if (cid) cid.value = componentId || '';
  if (nm) nm.value = label;
  if (search) search.value = label;
  if (unitEl && unit) unitEl.value = unit;
  // Контекст: для комплектующих категория из component_categories
  // (Воздухоохладители — единственная пересекающаяся с условным рендером)
  state._specFormCtx = {
    kind: 'component',
    directionName: '',
    categoryName: categoryName || '',
  };
  _rerenderSpecConditionalFields();
  const results = document.getElementById('spec-search-results');
  if (results) results.style.display = 'none';
  closeNomPicker();
  const qty = document.getElementById('spec-form-qty');
  if (qty) { qty.focus(); qty.select(); }
}

// ЭТАП 37: рендер дерева комплектующих в picker
function renderComponentsTree() {
  const body = document.getElementById('nom-picker-body');
  if (!body) return;
  const d = state._nomPicker.componentsData;
  if (!d) return;

  const filter = state._nomPicker.filter;
  const filteredComps = d.components.filter(c => {
    if (!c.is_active) return false;
    if (!filter) return true;
    return (c.name || '').toLowerCase().includes(filter) ||
           (c.sku || '').toLowerCase().includes(filter);
  });

  if (!filteredComps.length) {
    body.innerHTML = '<div class="nom-empty"><i class="ti ti-search-off" style="font-size:24px; display:block; margin-bottom:6px;"></i>' +
      (filter ? 'По запросу ничего не найдено' : 'Каталог комплектующих пуст') + '</div>';
    return;
  }

  // Группировка по category_id
  const byCat = {};
  filteredComps.forEach(c => {
    const cid = c.category_id || 0;
    if (!byCat[cid]) byCat[cid] = [];
    byCat[cid].push(c);
  });

  const autoOpen = !!filter;
  let html = '';
  (d.categories || []).forEach(cat => {
    const list = byCat[cat.id] || [];
    if (!list.length) return;
    const key = 'components:' + cat.id;
    const isOpen = autoOpen || state._nomPicker.openGroups[key];
    html += '<div class="nom-group ' + (isOpen ? 'open' : '') + '">';
    html += '<div class="nom-group-header" onclick="toggleNomGroup(\'' + key + '\')">';
    html += '<div class="name"><i class="ti ti-folder"></i>' + escapeHtml(cat.name) + '</div>';
    html += '<div style="display:flex; align-items:center; gap:8px;">';
    html += '<div class="count">' + list.length + '</div>';
    html += '<i class="ti ti-chevron-right chevron"></i>';
    html += '</div>';
    html += '</div>';
    html += '<div class="nom-group-items">';
    list.forEach(c => {
      const sku = c.sku || '';
      const name = c.name || '';
      const unit = c.unit || 'шт.';
      const label = (sku ? sku + ' · ' : '') + name;
      const labelJson = JSON.stringify(label).replace(/"/g, '&quot;');
      const unitJson = JSON.stringify(unit).replace(/"/g, '&quot;');
      const catJson = JSON.stringify(cat.name || '').replace(/"/g, '&quot;');
      html += '<div class="nom-item" onclick="pickNomComponent(' + c.id + ',' + labelJson + ',' + unitJson + ',' + catJson + ')">';
      html += '<div class="nom-item-title">' + (sku ? '<b>' + escapeHtml(sku) + '</b> · ' : '') + escapeHtml(name) + '</div>';
      const meta = [];
      if (unit) meta.push('ед.изм.: ' + unit);
      if (c.qty_on_stock != null) meta.push('на складе: ' + c.qty_on_stock + ' ' + unit);
      if (meta.length) html += '<div class="nom-item-meta">' + escapeHtml(meta.join(' · ')) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';
  });

  body.innerHTML = html;
}

// ============ КОНЕЦ ЭТАПА 27 ============


// ============ ЭТАП 26: блок отгрузки в карточке договора ============

// v2.45.142: откат отгрузки по QR с подтверждением паролём
async function rollbackContractShipment(contractId) {
  const password = await _promptPasswordForAction(
    'Откатить отгрузку по QR?',
    'Все отметки об отгрузке снимутся (счётчик вернётся к 0), статус — в «Готов к отгрузке». Подтверди личным паролём.'
  );
  if (password === null) return;   // отменили
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/contracts/' + contractId + '/shipments/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ password: password }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 && d.error === 'password_required') { showToast('Нужно подтвердить паролем', 'error'); return; }
      if (r.status === 403 && d.error === 'wrong_password') {
        if (typeof _clearCachedPassword === 'function') _clearCachedPassword();
        showToast('Неверный пароль — откат не выполнен', 'error'); return;
      }
      showToast(d.message || 'Не удалось откатить отгрузку', 'error'); return;
    }
    showToast('Отгрузка откачена', 'success');
    // Перерисовываем всю карточку договора — статус, сборки и счётчик станут актуальны
    if (typeof openContractDetail === 'function') openContractDetail(contractId);
    else loadContractShipmentBlock(contractId);
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

// v2.45.144: обновить область отгрузки (счётчик + коробки + сборки) одной кнопкой
function refreshContractShipmentArea(contractId) {
  if (typeof loadContractShipmentBlock === 'function') loadContractShipmentBlock(contractId);
  if (typeof loadContractBoxesBlock === 'function') loadContractBoxesBlock(contractId);
  if (typeof loadContractItemsBlock === 'function') loadContractItemsBlock(contractId);
  showToast('Обновлено', 'info');
}

async function loadContractShipmentBlock(contractId) {
  const container = document.getElementById('scd-shipment-block');
  if (!container) return;
  try {
    const s = await apiGet('/api/contracts/' + contractId + '/shipment-status');
    // Если бэк не задеплоен / endpoint отсутствует / total = 0 без коробок и сборок — блок не показываем
    if (!s || typeof s.total === 'undefined') {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }
    const total = s.total || 0;
    const shipped = s.shipped || 0;
    const pct = total > 0 ? Math.round(shipped / total * 100) : 0;
    const isComplete = s.is_complete;

    let html = '<div class="ship-progress-card" style="margin: 0;">';
    html += '<div class="ship-progress-head">';
    html += '<div class="ship-progress-title" style="display:flex;align-items:center;gap:6px;">' +
              '<i class="ti ti-truck-delivery" style="color: var(--c-prod-25);"></i> Отгрузка по QR' +
              // v2.45.144: кнопка «Обновить» — подтянуть актуальный прогресс после сканирования
              '<button onclick="refreshContractShipmentArea(' + contractId + ')" title="Обновить" ' +
                'style="background:none;border:1px solid var(--border);border-radius:8px;cursor:pointer;' +
                'color:var(--brand);padding:3px 7px;display:inline-flex;align-items:center;gap:4px;font-size:12px;">' +
                '<i class="ti ti-refresh"></i> Обновить</button>' +
            '</div>';
    if (total > 0) {
      html += '<div class="ship-progress-num">' + shipped + ' <span class="total">/ ' + total + '</span></div>';
    }
    html += '</div>';
    if (total > 0) {
      html += '<div class="ship-progress-bar"><div class="ship-progress-fill ' + (isComplete ? 'complete' : '') + '" style="width:' + pct + '%"></div></div>';
      if (isComplete) {
        html += '<button class="ship-start-btn complete" onclick="openShipmentMode(' + contractId + ')"><i class="ti ti-check-circle"></i> Всё отгружено · открыть</button>';
      } else {
        html += '<button class="ship-start-btn" onclick="openShipmentMode(' + contractId + ')"><i class="ti ti-scan"></i> Начать отгрузку</button>';
      }
      // v2.45.142: откат отгрузки (под паролем) — если что-то уже отгружено
      if (shipped > 0 && canManageSales()) {
        html += '<button onclick="rollbackContractShipment(' + contractId + ')" ' +
          'style="width:100%;margin-top:8px;background:none;border:1px solid #FCA5A5;color:#B91C1C;' +
          'padding:9px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;' +
          'display:flex;align-items:center;justify-content:center;gap:6px;">' +
          '<i class="ti ti-arrow-back-up"></i> Откатить отгрузку (' + shipped + ')</button>';
      }
    } else {
      html += '<div style="font-size:13px;color:var(--text-light);padding:8px 0;text-align:center;">К договору не привязано ни одной сборки или коробки.<br>Добавьте сборки или создайте коробки.</div>';
      html += '<button class="ship-start-btn" onclick="openShipmentMode(' + contractId + ')"><i class="ti ti-scan"></i> Открыть отгрузку</button>';
    }
    html += '</div>';

    // v2.45.312: раздел «К отгрузке» — развёрнутый список единиц отгрузки
    // (коробки + отдельные узлы/сборки), как просил директор.
    const units = s.items || [];
    if (units.length) {
      const boxes = units.filter(u => u.type === 'box');
      const asms = units.filter(u => u.type !== 'box');
      html += '<div class="ship-units-card" style="margin-top:14px;background:white;border:1px solid var(--border);border-radius:12px;padding:12px 14px;">';
      html += '<div style="font-size:13px;font-weight:700;color:var(--text-dark);margin-bottom:8px;display:flex;align-items:center;gap:6px;">' +
        '<i class="ti ti-list-check" style="color:var(--brand);"></i> К отгрузке <span style="color:var(--text-light);font-weight:400;">(' + units.length + ' ед.)</span></div>';
      html += '<div style="font-size:12px;color:var(--text-light);margin-bottom:8px;">' +
        'Что физически уезжает с производства: коробки (в них упаковано покупное и мелочь) и отдельные узлы/сборки.</div>';
      const _unitRow = (u) => {
        const done = !!u.shipped;
        const icon = u.type === 'box' ? 'ti-package' : 'ti-tool';
        const qtyLabel = u.type === 'box'
          ? ((u.asm_count || u.qty || 0) + ' ' + (typeof pluralAssemblies === 'function' ? pluralAssemblies(u.asm_count || u.qty || 0) : 'шт.'))
          : ((u.qty || 1) + ' шт.');
        const badge = done
          ? '<span style="font-size:11px;font-weight:700;color:#15803D;background:#DCFCE7;padding:1px 8px;border-radius:6px;white-space:nowrap;"><i class="ti ti-check" style="font-size:11px;"></i> отгружено</span>'
          : '<span style="font-size:11px;font-weight:700;color:#9A3412;background:#FFEDD5;padding:1px 8px;border-radius:6px;white-space:nowrap;">готово к отгрузке</span>';
        const clickAttr = u.type === 'box'
          ? ' style="cursor:pointer;" onclick="openBoxDetail(' + u.id + ')" title="Открыть коробку"'
          : ' style="cursor:default;"';
        return '<div' + clickAttr + ' style="display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid var(--border);">' +
          '<div style="width:30px;height:30px;border-radius:8px;background:' + (done ? '#E8F5E9' : 'var(--brand-bg)') + ';color:' + (done ? '#15803D' : 'var(--brand)') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
            '<i class="ti ' + icon + '"></i></div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:13.5px;font-weight:600;color:var(--text-dark);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(u.name || '') + '</div>' +
            '<div style="font-size:11.5px;color:var(--text-light);">' + (u.type === 'box' ? 'Коробка · ' : 'Узел / сборка · ') + qtyLabel + '</div>' +
          '</div>' +
          badge +
        '</div>';
      };
      if (boxes.length) {
        html += '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-light);font-weight:600;margin:6px 0 2px;">Коробки</div>';
        boxes.forEach(u => { html += _unitRow(u); });
      }
      if (asms.length) {
        html += '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-light);font-weight:600;margin:10px 0 2px;">Узлы и сборки (отдельно)</div>';
        asms.forEach(u => { html += _unitRow(u); });
      }
      html += '</div>';
    }

    container.innerHTML = html;
    container.style.display = '';
  } catch (e) {
    // Бэк недоступен или endpoint ещё не задеплоен — просто скрываем блок без видимой ошибки
    container.style.display = 'none';
    container.innerHTML = '';
  }
}

// ============ ЭТАП 26: блок коробок договора ============

async function loadContractBoxesBlock(contractId) {
  const container = document.getElementById('scd-boxes-block');
  if (!container) return;
  try {
    const r = await apiGet('/api/contracts/' + contractId + '/boxes');
    // ЭТАП 30.1-fix: сохраняем список локально, чтобы openBoxDetail брал контекст коробки без /full
    state._currentContractBoxes = r.boxes || [];
    renderContractBoxesBlock(contractId, r.boxes || []);
  } catch (e) {
    // Бэк может не отвечать — просто скрываем без видимой ошибки
    container.style.display = 'none';
    container.innerHTML = '';
  }
}

function renderContractBoxesBlock(contractId, boxes) {
  const container = document.getElementById('scd-boxes-block');
  if (!container) return;
  const canEdit = canManageSales();
  const total = boxes.length;
  const shippedCnt = boxes.filter(b => b.is_shipped).length;

  let html = '<div class="contract-block">';
  html += '<div class="contract-block-header">';
  html += '<div class="contract-block-title"><i class="ti ti-package"></i> Коробки';
  if (total) html += ' <span class="contract-block-counter">' + total + '</span>';
  html += '</div>';
  if (canEdit) {
    html += '<button class="btn btn-primary btn-small" onclick="createBoxForContract(' + contractId + ')">' +
      '<i class="ti ti-plus"></i> Добавить</button>';
  }
  html += '</div>';

  if (!total) {
    html += '<div class="empty-block" style="padding: 18px;">' +
      '<i class="ti ti-package-off"></i>Коробок пока нет.<br>' +
      'Добавьте коробку — получите QR-код для печати на наклейку.' +
    '</div>';
  } else {
    html += '<div style="padding: 6px 14px 14px;">';
    boxes.forEach(b => {
      const shipped = !!b.is_shipped;
      const meta = [];
      if (b.description) meta.push(escapeHtml(b.description));
      if (shipped && b.shipped_at) meta.push('отгружено ' + String(b.shipped_at).slice(0, 16).replace('T', ' '));
      html += '<div class="box-row" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;" onclick="openBoxDetail(' + b.id + ')">';
      html += '<div style="width:32px;height:32px;border-radius:8px;background:' +
        (shipped ? '#E8F5E9' : 'var(--brand-bg)') + ';color:' +
        (shipped ? '#15803D' : 'var(--brand)') +
        ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
        '<i class="ti ' + (shipped ? 'ti-package-export' : 'ti-package') + '"></i></div>';
      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="font-size:14px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
        escapeHtml(b.name || ('Коробка #' + b.id)) + '</div>';
      if (meta.length) {
        html += '<div style="font-size:12px;color:var(--text-light);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
          meta.join(' · ') + '</div>';
      }
      html += '</div>';
      // Действия — не должны провоцировать клик по строке
      html += '<div style="display:flex;gap:4px;flex-shrink:0;" onclick="event.stopPropagation()">';
      html += '<button class="btn btn-secondary btn-small" title="QR-код / печать" onclick="showBoxQr(' +
        b.id + ', ' + JSON.stringify(b.name || ('Коробка #' + b.id)).replace(/"/g, '&quot;') +
        ', ' + JSON.stringify(b.qr_token || '').replace(/"/g, '&quot;') +
        ', ' + JSON.stringify(b.contract_number || '').replace(/"/g, '&quot;') +
        ', ' + JSON.stringify(b.contractor_name || '').replace(/"/g, '&quot;') + ')">' +
        '<i class="ti ti-qrcode"></i></button>';
      if (canEdit && !shipped) {
        html += '<button class="btn btn-secondary btn-small" title="Переименовать" onclick="renameBox(' +
          b.id + ', ' + JSON.stringify(b.name || '').replace(/"/g, '&quot;') + ', ' + contractId + ')">' +
          '<i class="ti ti-edit"></i></button>';
        html += '<button class="btn btn-secondary btn-small" title="Удалить" onclick="confirmDeleteBox(' +
          b.id + ', ' + contractId + ')" style="color:var(--danger);">' +
          '<i class="ti ti-trash"></i></button>';
      }
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  html += '</div>';
  container.innerHTML = html;
  container.style.display = '';
}

async function createBoxForContract(contractId) {
  if (!canManageSales()) {
    showToast('Создавать коробки может директор, зам или менеджер', 'error');
    return;
  }
  // ЭТАП 30: имя задаётся автоматически («Коробка #N»), после создания
  // сразу открывается экран коробки для наполнения содержимым.
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/contracts/' + contractId + '/boxes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ name: '' }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось создать коробку', 'error');
      return;
    }
    const box = await r.json();
    showToast('Коробка создана', 'success');
    // ЭТАП 30.1-fix: чтобы экран коробки сразу открылся без падений,
    // дожидаемся загрузки списка (там обновится state._currentContractBoxes)
    await loadContractBoxesBlock(contractId);
    loadContractShipmentBlock(contractId);
    // Сразу открываем экран коробки для добавления позиций
    openBoxDetail(box.id);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

function showBoxQr(boxId, boxName, qrToken, contractNumber, contractorName) {
  if (!qrToken) {
    showToast('У коробки нет QR-токена', 'error');
    return;
  }
  const url = window.location.origin + '/b/' + qrToken;
  const subtitle = [
    contractNumber ? 'Договор № ' + contractNumber : '',
    contractorName || '',
  ].filter(Boolean).join(' · ');
  openQrModal({
    title: 'QR-код · ' + boxName,
    subtitle: subtitle,
    url: url,
    type: 'box',
    data: {
      boxId: boxId,
      boxName: boxName,
      token: qrToken,
      contractNumber: contractNumber,
      contractorName: contractorName,
    },
  });
}

async function renameBox(boxId, currentName, contractId) {
  const newName = prompt('Новое имя коробки:', currentName || '');
  if (newName === null) return;
  const trimmed = String(newName || '').trim();
  if (!trimmed) {
    showToast('Имя не может быть пустым', 'error');
    return;
  }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/boxes/' + boxId, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось переименовать', 'error');
      return;
    }
    showToast('Переименовано', 'success');
    loadContractBoxesBlock(contractId);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function confirmDeleteBox(boxId, contractId) {
  if (!confirm('Удалить коробку? Это действие нельзя отменить (но восстановить через БД можно).')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/boxes/' + boxId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось удалить коробку', 'error');
      return;
    }
    showToast('Коробка удалена', 'success');
    loadContractBoxesBlock(contractId);
    loadContractShipmentBlock(contractId);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// ============ ЭТАП 30.1: ЭКРАН КОРОБКИ С СОДЕРЖИМЫМ ============

async function openBoxDetail(boxId) {
  // Открываем модалку с прелоадом
  let m = document.getElementById('box-detail-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'box-detail-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) closeBoxDetail(); };
    document.body.appendChild(m);
  }
  m.innerHTML = '<div class="modal modal-wide" onclick="event.stopPropagation()"><div class="loading-block" style="padding:40px;">Загружаем коробку…</div></div>';
  m.classList.add('visible');
  state._currentBoxId = boxId;

  // ЭТАП 30.1-fix: НЕ дёргаем /full (он может падать на сложных JOIN'ах в проде).
  // Берём контекст коробки из локального кэша списка коробок текущего договора,
  // а содержимое — через простой /items. Если ничего не нашли — fallback на /full.
  let box = null;
  try {
    if (state._currentContractBoxes && state._currentContractBoxes.length) {
      box = state._currentContractBoxes.find(b => b.id === boxId);
    }
    const token = localStorage.getItem(TOKEN_KEY);
    const auth = { 'Authorization': 'Bearer ' + token };

    // Если в локальном кэше нет (например, открыли по ссылке) — пробуем сначала /full,
    // потом fallback на список коробок договора.
    if (!box) {
      try {
        const rFull = await fetch(API_BASE + '/api/boxes/' + boxId + '/full', { headers: auth });
        if (rFull.ok) {
          box = await rFull.json();
        }
      } catch (e) { /* fallback ниже */ }
    }

    // Получаем содержимое отдельным запросом (всегда — может измениться)
    let items = [];
    try {
      const rItems = await fetch(API_BASE + '/api/boxes/' + boxId + '/items', { headers: auth });
      if (rItems.ok) {
        const d = await rItems.json();
        items = d.items || [];
      }
    } catch (e) { /* пустой список — не критично */ }

    if (!box) {
      // Совсем не получилось — заглушка
      m.innerHTML = '<div class="modal modal-wide" onclick="event.stopPropagation()"><div class="modal-header"><h3>Коробка</h3><button class="modal-close" onclick="closeBoxDetail()"><i class="ti ti-x"></i></button></div><div style="padding:40px;text-align:center;color:var(--danger);">Не удалось загрузить данные коробки.<br><br>Обновите страницу (Ctrl+Shift+R).</div></div>';
      return;
    }

    box.items = items;
    state._currentBox = box;
    renderBoxDetail(box);
  } catch (e) {
    console.error('openBoxDetail error:', e);
    m.innerHTML = '<div class="modal modal-wide" onclick="event.stopPropagation()"><div class="modal-header"><h3>Коробка</h3><button class="modal-close" onclick="closeBoxDetail()"><i class="ti ti-x"></i></button></div><div style="padding:40px;text-align:center;color:var(--danger);">Ошибка: ' + (e.message || e) + '</div></div>';
  }
}

function closeBoxDetail() {
  const m = document.getElementById('box-detail-modal');
  if (m) m.classList.remove('visible');
  state._currentBoxId = null;
  state._currentBox = null;
}

function renderBoxDetail(box) {
  const m = document.getElementById('box-detail-modal');
  if (!m) return;
  const canEdit = canManageSales() && !box.is_shipped;
  const items = box.items || [];
  let totalQty = 0;
  items.forEach(i => { totalQty += Number(i.qty) || 0; });

  let itemsHtml = '';
  if (!items.length) {
    itemsHtml = '<div style="padding: 30px 14px;text-align:center;color:var(--text-light);">' +
      '<i class="ti ti-package-off" style="font-size:32px;display:block;margin-bottom:8px;"></i>' +
      'Коробка пуста. Добавь позиции ниже.' +
      '</div>';
  } else {
    itemsHtml = '<div style="padding:6px 14px;">';
    items.forEach((it, idx) => {
      const srcIcon = it.source_type === 'assembly' ? 'ti-tool' :
                      (it.source_type === 'contract_item' ? 'ti-list' : 'ti-edit');
      const srcLabel = it.source_type === 'assembly' ? 'из сборок' :
                       (it.source_type === 'contract_item' ? 'из спецификации' : 'вручную');
      itemsHtml += '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">';
      itemsHtml += '<div style="width:26px;text-align:center;color:var(--text-light);font-size:13px;">' + (idx + 1) + '</div>';
      itemsHtml += '<div style="flex:1;min-width:0;">';
      itemsHtml += '<div style="font-size:14px;font-weight:600;color:var(--text);">' + escapeHtml(it.name || '—') + '</div>';
      itemsHtml += '<div style="font-size:12px;color:var(--text-light);">' +
                   '<i class="ti ' + srcIcon + '" style="vertical-align:middle;"></i> ' + srcLabel +
                   (it.comment ? ' · ' + escapeHtml(it.comment) : '') +
                   '</div>';
      itemsHtml += '</div>';
      itemsHtml += '<div style="font-weight:600;font-size:14px;white-space:nowrap;">' +
                   (Number(it.qty) % 1 === 0 ? Number(it.qty) : Number(it.qty).toFixed(2)) +
                   ' ' + escapeHtml(it.unit || 'шт.') + '</div>';
      if (canEdit) {
        itemsHtml += '<button class="btn btn-secondary btn-small" title="Удалить" onclick="removeBoxItem(' +
                     it.id + ')" style="color:var(--danger);"><i class="ti ti-trash"></i></button>';
      }
      itemsHtml += '</div>';
    });
    itemsHtml += '</div>';
  }

  const header =
    '<div class="modal-header">' +
      '<h3><i class="ti ti-package"></i> ' + escapeHtml(box.name || ('Коробка #' + box.id)) +
        (box.is_shipped ? ' <span style="color:#15803D;font-size:13px;font-weight:500;">· отгружено</span>' : '') +
      '</h3>' +
      '<button class="modal-close" onclick="closeBoxDetail()"><i class="ti ti-x"></i></button>' +
    '</div>';

  const subtitle =
    '<div style="padding:12px 18px 14px;border-bottom:1px solid var(--border);">' +
      '<div style="font-size:13px;color:var(--text-light);">' +
        (box.contract_number ? 'Договор № ' + escapeHtml(String(box.contract_number).replace(/^\s*№\s*/, '')) : '—') +
        (box.contractor_name ? ' · ' + escapeHtml(box.contractor_name) : '') +
      '</div>' +
    '</div>';

  const itemsBlock =
    '<div style="padding:6px 0;">' +
      '<div style="padding:12px 18px 6px;font-size:12px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;">' +
        'Содержимое' + (items.length ? ' (' + items.length + ')' : '') +
      '</div>' +
      itemsHtml +
    '</div>';

  const addBtns = canEdit ?
    '<div style="padding:14px 18px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border);">' +
      '<button class="btn btn-primary btn-small" onclick="openAddBoxItemFromCatalog(' + box.id + ')">' +
        '<i class="ti ti-list-search"></i> Из номенклатуры</button>' +
      '<button class="btn btn-secondary btn-small" onclick="openAddBoxItemManual(' + box.id + ')">' +
        '<i class="ti ti-edit"></i> Вручную</button>' +
    '</div>' : '';

  const actionsBlock =
    '<div style="padding:14px 18px;display:flex;gap:8px;flex-wrap:wrap;background:var(--bg);border-top:1px solid var(--border);">' +
      (items.length ? '<button class="btn btn-primary btn-small" onclick="printPackingList(' + box.id + ')">' +
                      '<i class="ti ti-printer"></i> Упаковочный лист (A4)</button>' : '') +
      '<button class="btn btn-secondary btn-small" onclick="showBoxQr(' + box.id + ', ' +
        JSON.stringify(box.name || ('Коробка #' + box.id)).replace(/"/g, '&quot;') + ', ' +
        JSON.stringify(box.qr_token || '').replace(/"/g, '&quot;') + ', ' +
        JSON.stringify(box.contract_number || '').replace(/"/g, '&quot;') + ', ' +
        JSON.stringify(box.contractor_name || '').replace(/"/g, '&quot;') + ')">' +
        '<i class="ti ti-qrcode"></i> QR / наклейка</button>' +
      (canEdit ? '<button class="btn btn-secondary btn-small" onclick="renameBoxFromDetail(' + box.id + ', ' +
                 JSON.stringify(box.name || '').replace(/"/g, '&quot;') + ')">' +
                 '<i class="ti ti-edit"></i> Переименовать</button>' : '') +
      (totalQty ? '<div style="margin-left:auto;font-size:13px;color:var(--text-light);align-self:center;">Всего: <b style="color:var(--text);">' + (totalQty % 1 === 0 ? totalQty : totalQty.toFixed(2)) + '</b></div>' : '') +
    '</div>';

  m.innerHTML = '<div class="modal modal-wide" onclick="event.stopPropagation()" style="max-width:680px;">' +
    header + subtitle + itemsBlock + addBtns + actionsBlock +
  '</div>';
}

async function removeBoxItem(itemId) {
  if (!confirm('Удалить позицию из коробки?')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/box-items/' + itemId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось удалить', 'error');
      return;
    }
    showToast('Позиция удалена', 'success');
    // Перезагружаем коробку
    if (state._currentBoxId) openBoxDetail(state._currentBoxId);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function renameBoxFromDetail(boxId, currentName) {
  const newName = prompt('Новое имя коробки:', currentName || '');
  if (newName === null) return;
  const trimmed = String(newName || '').trim();
  if (!trimmed) {
    showToast('Имя не может быть пустым', 'error');
    return;
  }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/boxes/' + boxId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось переименовать', 'error');
      return;
    }
    showToast('Переименовано', 'success');
    openBoxDetail(boxId);
    // Обновим блок коробок в карточке договора
    if (state._currentBox && state._currentBox.contract_id) {
      loadContractBoxesBlock(state._currentBox.contract_id);
    }
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// ============ Добавление позиций в коробку ============

// Из номенклатуры/сборок/спецификации
async function openAddBoxItemFromCatalog(boxId) {
  const box = state._currentBox;
  if (!box) return;
  const contractId = box.contract_id;
  // Параллельно тянем: сборки этого договора + позиции спецификации + общий каталог моделей
  let assemblies = [], specItems = [], models = [];
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const auth = { 'Authorization': 'Bearer ' + token };
    if (contractId) {
      const [aR, sR] = await Promise.all([
        fetch(API_BASE + '/api/contracts/' + contractId + '/assemblies', { headers: auth }).catch(() => null),
        fetch(API_BASE + '/api/contracts/' + contractId + '/items', { headers: auth }).catch(() => null),
      ]);
      if (aR && aR.ok) { const d = await aR.json(); assemblies = d.assemblies || d.items || []; }
      if (sR && sR.ok) { const d = await sR.json(); specItems = d.items || []; }
    }
    const mR = await fetch(API_BASE + '/api/sales-models', { headers: auth }).catch(() => null);
    if (mR && mR.ok) { const d = await mR.json(); models = d.models || d.items || []; }
  } catch (e) {
    // не критично
  }

  // Рендерим модалку поверх детали коробки
  let pick = document.getElementById('box-item-picker');
  if (!pick) {
    pick = document.createElement('div');
    pick.id = 'box-item-picker';
    pick.className = 'modal-overlay';
    pick.style.zIndex = 10500;
    pick.onclick = (e) => { if (e.target === pick) closeBoxItemPicker(); };
    document.body.appendChild(pick);
  }

  let optsHtml = '';

  // Сборки договора
  if (assemblies && assemblies.length) {
    optsHtml += '<div style="padding:10px 16px 4px;font-size:12px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;">Сборки этого договора</div>';
    assemblies.forEach(a => {
      const mn = a.model_name || '—';
      const ma = a.model_article ? ' · ' + a.model_article : '';
      optsHtml += '<div class="pick-row" onclick="addBoxItemFromAssembly(' + boxId + ', ' + a.id + ', ' +
                  JSON.stringify(mn + ma).replace(/"/g, '&quot;') + ', ' + (a.quantity || 1) + ')">' +
                  '<i class="ti ti-tool" style="color:var(--brand);"></i>' +
                  '<div style="flex:1;"><div style="font-weight:600;">' + escapeHtml(mn) + '</div>' +
                  '<div style="font-size:12px;color:var(--text-light);">' + escapeHtml(a.model_article || '') +
                  ' · ' + (a.quantity || 1) + ' шт.</div></div>' +
                  '</div>';
    });
  }

  // Спецификация договора
  if (specItems && specItems.length) {
    optsHtml += '<div style="padding:10px 16px 4px;font-size:12px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;">Позиции спецификации</div>';
    specItems.forEach(si => {
      optsHtml += '<div class="pick-row" onclick="addBoxItemFromSpec(' + boxId + ', ' + si.id + ', ' +
                  JSON.stringify(si.name || '').replace(/"/g, '&quot;') + ', ' + (si.qty || 1) + ', ' +
                  JSON.stringify(si.unit || 'шт.').replace(/"/g, '&quot;') + ')">' +
                  '<i class="ti ti-list" style="color:var(--brand);"></i>' +
                  '<div style="flex:1;"><div style="font-weight:600;">' + escapeHtml(si.name || '—') + '</div>' +
                  '<div style="font-size:12px;color:var(--text-light);">' +
                  (si.qty || 1) + ' ' + escapeHtml(si.unit || 'шт.') + '</div></div>' +
                  '</div>';
    });
  }

  // Общая номенклатура (модели)
  if (models && models.length) {
    optsHtml += '<div style="padding:10px 16px 4px;font-size:12px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;">Номенклатура (' + models.length + ')</div>';
    optsHtml += '<input type="text" id="box-item-search" placeholder="Поиск по названию или артикулу…" onkeyup="filterBoxItemPicker(this.value)" style="margin:6px 16px;padding:8px 12px;width:calc(100% - 32px);border:1px solid var(--border);border-radius:8px;font-size:13px;">';
    models.forEach(mdl => {
      optsHtml += '<div class="pick-row pick-model" data-search="' +
                  escapeHtml((mdl.name + ' ' + (mdl.article || '')).toLowerCase()) + '" ' +
                  'onclick="addBoxItemFromModel(' + boxId + ', ' +
                  JSON.stringify(mdl.name || '').replace(/"/g, '&quot;') + ', ' +
                  JSON.stringify(mdl.article || '').replace(/"/g, '&quot;') + ')">' +
                  '<i class="ti ti-box" style="color:var(--brand);"></i>' +
                  '<div style="flex:1;"><div style="font-weight:600;">' + escapeHtml(mdl.name || '—') + '</div>' +
                  (mdl.article ? '<div style="font-size:12px;color:var(--text-light);">' + escapeHtml(mdl.article) + '</div>' : '') +
                  '</div></div>';
    });
  }

  if (!optsHtml) {
    optsHtml = '<div style="padding:30px;text-align:center;color:var(--text-light);">Нет позиций для добавления. Используй «Вручную».</div>';
  }

  pick.innerHTML = '<div class="modal modal-wide" onclick="event.stopPropagation()" style="max-width:560px;max-height:85vh;display:flex;flex-direction:column;">' +
    '<div class="modal-header">' +
      '<h3><i class="ti ti-list-search"></i> Выбор позиции</h3>' +
      '<button class="modal-close" onclick="closeBoxItemPicker()"><i class="ti ti-x"></i></button>' +
    '</div>' +
    '<style>.pick-row{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);cursor:pointer;}.pick-row:hover{background:var(--brand-bg);}</style>' +
    '<div style="overflow-y:auto;flex:1;">' + optsHtml + '</div>' +
  '</div>';
  pick.classList.add('visible');
}

function closeBoxItemPicker() {
  const pick = document.getElementById('box-item-picker');
  if (pick) pick.classList.remove('visible');
}

function filterBoxItemPicker(q) {
  const ql = (q || '').toLowerCase().trim();
  document.querySelectorAll('#box-item-picker .pick-model').forEach(el => {
    const s = el.getAttribute('data-search') || '';
    el.style.display = (!ql || s.indexOf(ql) >= 0) ? '' : 'none';
  });
}

async function _postBoxItem(boxId, payload) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/boxes/' + boxId + '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось добавить', 'error');
      return false;
    }
    showToast('Добавлено', 'success');
    closeBoxItemPicker();
    openBoxDetail(boxId);
    return true;
  } catch (e) {
    showToast('Ошибка соединения', 'error');
    return false;
  }
}

async function addBoxItemFromAssembly(boxId, asmId, displayName, qty) {
  await _postBoxItem(boxId, {
    name: displayName, qty: qty, unit: 'шт.',
    source_type: 'assembly', source_id: asmId,
  });
}

async function addBoxItemFromSpec(boxId, specId, name, qty, unit) {
  const customQty = prompt('Сколько кладём в коробку? (по спецификации: ' + qty + ' ' + unit + ')', qty);
  if (customQty === null) return;
  const n = parseFloat(customQty);
  if (isNaN(n) || n <= 0) {
    showToast('Некорректное количество', 'error');
    return;
  }
  await _postBoxItem(boxId, {
    name: name, qty: n, unit: unit,
    source_type: 'contract_item', source_id: specId,
  });
}

async function addBoxItemFromModel(boxId, name, article) {
  const customQty = prompt('Сколько кладём в коробку?', '1');
  if (customQty === null) return;
  const n = parseFloat(customQty);
  if (isNaN(n) || n <= 0) {
    showToast('Некорректное количество', 'error');
    return;
  }
  const fullName = name + (article ? ' · ' + article : '');
  await _postBoxItem(boxId, {
    name: fullName, qty: n, unit: 'шт.',
    source_type: 'manual',
  });
}

// Ввод вручную
function openAddBoxItemManual(boxId) {
  let pick = document.getElementById('box-item-picker');
  if (!pick) {
    pick = document.createElement('div');
    pick.id = 'box-item-picker';
    pick.className = 'modal-overlay';
    pick.style.zIndex = 10500;
    pick.onclick = (e) => { if (e.target === pick) closeBoxItemPicker(); };
    document.body.appendChild(pick);
  }
  pick.innerHTML = '<div class="modal" onclick="event.stopPropagation()" style="max-width:440px;">' +
    '<div class="modal-header">' +
      '<h3><i class="ti ti-edit"></i> Добавить позицию вручную</h3>' +
      '<button class="modal-close" onclick="closeBoxItemPicker()"><i class="ti ti-x"></i></button>' +
    '</div>' +
    '<div style="padding:18px;">' +
      '<label style="display:block;margin-bottom:10px;font-size:13px;color:var(--text-light);">Название</label>' +
      '<input type="text" id="manual-item-name" placeholder="Например: Кабель ВВГнг 3х2.5" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:14px;" />' +
      '<div style="display:flex;gap:10px;margin-bottom:14px;">' +
        '<div style="flex:1;">' +
          '<label style="display:block;margin-bottom:6px;font-size:13px;color:var(--text-light);">Кол-во</label>' +
          '<input type="number" id="manual-item-qty" value="1" min="0" step="0.01" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;" />' +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="display:block;margin-bottom:6px;font-size:13px;color:var(--text-light);">Ед.</label>' +
          '<select id="manual-item-unit" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:white;">' +
            '<option value="шт.">шт.</option><option value="м">м</option><option value="кг">кг</option>' +
            '<option value="л">л</option><option value="компл.">компл.</option><option value="уп.">уп.</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<label style="display:block;margin-bottom:6px;font-size:13px;color:var(--text-light);">Комментарий (необязательно)</label>' +
      '<input type="text" id="manual-item-comment" placeholder="" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:18px;" />' +
      '<button class="btn btn-primary" onclick="submitManualBoxItem(' + boxId + ')" style="width:100%;"><i class="ti ti-check"></i> Добавить</button>' +
    '</div>' +
  '</div>';
  pick.classList.add('visible');
  setTimeout(() => { const i = document.getElementById('manual-item-name'); if (i) i.focus(); }, 100);
}

async function submitManualBoxItem(boxId) {
  const name = (document.getElementById('manual-item-name').value || '').trim();
  const qty = parseFloat(document.getElementById('manual-item-qty').value || '1');
  const unit = document.getElementById('manual-item-unit').value || 'шт.';
  const comment = (document.getElementById('manual-item-comment').value || '').trim();
  if (!name) { showToast('Введите название', 'error'); return; }
  if (isNaN(qty) || qty <= 0) { showToast('Некорректное количество', 'error'); return; }
  await _postBoxItem(boxId, {
    name: name, qty: qty, unit: unit, comment: comment, source_type: 'manual',
  });
}

// ============ ПЕЧАТЬ УПАКОВОЧНОГО ЛИСТА (A4) ============

async function printPackingList(boxId) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/boxes/' + boxId + '/full', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) { showToast('Не удалось загрузить коробку', 'error'); return; }
    const box = await r.json();
    renderPackingListPrint(box);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

function renderPackingListPrint(box) {
  const items = box.items || [];
  const total = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = today.getFullYear();
  const todayStr = dd + '.' + mm + '.' + yyyy;

  const html =
    '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">' +
    '<title>Упаковочный лист — ' + escapeHtml(box.name || ('Коробка #' + box.id)) + '</title>' +
    '<style>' +
      '@page { size: A4 portrait; margin: 16mm 14mm; }' +
      '* { box-sizing: border-box; }' +
      'body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1B2030; margin: 0; padding: 20px; font-size: 12pt; line-height: 1.4; }' +
      '.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #2D5F8B; padding-bottom: 10px; margin-bottom: 16px; }' +
      '.brand { font-size: 18pt; font-weight: 600; color: #2D5F8B; }' +
      '.brand-sub { font-size: 9pt; color: #6E7689; margin-top: 2px; }' +
      '.contacts { font-size: 9pt; color: #6E7689; text-align: right; }' +
      'h1 { font-size: 16pt; font-weight: 700; margin: 12px 0 8px; text-align: center; letter-spacing: 0.5px; }' +
      '.subtitle { text-align: center; color: #4A5061; font-size: 11pt; margin-bottom: 18px; }' +
      '.meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; margin: 14px 0 18px; border: 1px solid #DCE3ED; border-radius: 6px; padding: 12px 14px; background: #F4F6FA; }' +
      '.meta-row { font-size: 10.5pt; }' +
      '.meta-row span { color: #6E7689; }' +
      '.meta-row b { color: #1B2030; font-weight: 600; }' +
      'table { width: 100%; border-collapse: collapse; margin: 6px 0 16px; }' +
      'th, td { border: 1px solid #DCE3ED; padding: 8px 10px; font-size: 10.5pt; text-align: left; vertical-align: top; }' +
      'th { background: #EAF2FA; color: #2D5F8B; font-weight: 600; font-size: 10pt; text-transform: uppercase; letter-spacing: 0.3px; }' +
      'td.num { text-align: center; width: 36px; }' +
      'td.qty { text-align: right; white-space: nowrap; width: 90px; font-weight: 600; }' +
      'td.unit { text-align: center; width: 60px; }' +
      'tr.total td { font-weight: 700; background: #F4F6FA; }' +
      '.footer-row { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; align-items: flex-end; margin-top: 28px; }' +
      '.sign { border-bottom: 1px solid #1B2030; min-height: 38px; padding: 6px 0; font-size: 9.5pt; color: #6E7689; }' +
      '.sign-label { font-size: 9pt; color: #6E7689; margin-top: 4px; text-align: center; }' +
      '.print-btn { position: fixed; top: 14px; right: 14px; background: #2D5F8B; color: white; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }' +
      '.no-print { display: block; }' +
      '@media print { .no-print { display: none; } body { padding: 0; } }' +
    '</style></head><body>' +
    '<button class="print-btn no-print" onclick="window.print()">🖨️ Печать</button>' +
    '<div class="header">' +
      '<div><div class="brand">Atom CRM</div><div class="brand-sub">ООО «Атомус Групп», Миасс</div></div>' +
      '<div class="contacts">тел. +7 (912) 326-30-03<br>atomusgroup174@yandex.ru</div>' +
    '</div>' +
    '<h1>УПАКОВОЧНЫЙ ЛИСТ</h1>' +
    '<div class="subtitle">' +
      (box.contract_number ? 'к договору № ' + escapeHtml(String(box.contract_number).replace(/^\s*№\s*/, '')) : 'без договора') +
      (box.contract_sign_date ? ' от ' + escapeHtml(box.contract_sign_date) : '') +
    '</div>' +
    '<div class="meta">' +
      '<div class="meta-row"><span>Контрагент:</span> <b>' + escapeHtml(box.contractor_name || '—') + '</b></div>' +
      '<div class="meta-row"><span>ИНН:</span> <b>' + escapeHtml(box.contractor_inn || '—') + '</b></div>' +
      '<div class="meta-row" style="grid-column:1/-1;"><span>Адрес доставки:</span> <b>' + escapeHtml(box.contract_delivery_address || '—') + '</b></div>' +
      '<div class="meta-row"><span>Коробка:</span> <b>' + escapeHtml(box.name || ('Коробка #' + box.id)) + '</b></div>' +
      '<div class="meta-row"><span>Дата упаковки:</span> <b>' + todayStr + '</b></div>' +
    '</div>' +
    (items.length ?
      '<table><thead><tr>' +
        '<th class="num">№</th><th>Наименование</th><th class="qty">Кол-во</th><th class="unit">Ед.</th>' +
      '</tr></thead><tbody>' +
      items.map((it, i) =>
        '<tr><td class="num">' + (i + 1) + '</td>' +
        '<td>' + escapeHtml(it.name || '—') +
          (it.comment ? '<div style="color:#6E7689;font-size:9.5pt;margin-top:2px;">' + escapeHtml(it.comment) + '</div>' : '') +
        '</td>' +
        '<td class="qty">' + (Number(it.qty) % 1 === 0 ? Number(it.qty) : Number(it.qty).toFixed(2)) + '</td>' +
        '<td class="unit">' + escapeHtml(it.unit || 'шт.') + '</td></tr>'
      ).join('') +
      '<tr class="total"><td colspan="2" style="text-align:right;">Всего позиций:</td><td class="qty">' + items.length + '</td><td class="unit">—</td></tr>' +
      '</tbody></table>'
      : '<p style="text-align:center;color:#6E7689;margin:30px 0;">Содержимое коробки не указано.</p>'
    ) +
    '<div class="footer-row">' +
      // Имя упаковщика не подставляем — линия пустая, расписываются от руки.
      '<div><div class="sign">&nbsp;</div><div class="sign-label">Упаковал (подпись)</div></div>' +
      '<div><div class="sign">&nbsp;</div><div class="sign-label">Принял (подпись)</div></div>' +
    '</div>' +
    '<script>window.addEventListener("DOMContentLoaded", function(){setTimeout(function(){window.print();}, 200);});<\/script>' +
    '</body></html>';

  const w = window.open('', '_blank');
  if (!w) { showToast('Разрешите всплывающие окна', 'error'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

