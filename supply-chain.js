/* v2.46.283 — Снабжение: одна обязательная цепочка закупки.
 *
 * ТЗ «Снабжение. Одна обязательная цепочка закупки, обязательное назначение,
 * «Ждём поставку» без пропусков». Отдельный файл поверх app-3.js:
 *   • тип закупки (товар / изготовление / услуга) и «Куда» (договор / склад / цех)
 *     в «Оформить заказ» и «Загрузить счёт», чип назначения у каждой строки,
 *     массовое присвоение, кнопка «Отправить» неактивна без назначения;
 *   • «Ждём поставку» по строкам заказов (/api/supply/waiting): чип назначения,
 *     степпер из 7 шагов, дни в шаге, дата поставки, группировка
 *     «по договору / по поставщику», блок «Счета без позиций»;
 *   • вкладка «Зависли» (/api/supply/stuck) и «Напомнить поставщику» —
 *     только черновик письма, отправка руками;
 *   • «На оплату»: поиск на бэке с «где совпало», чипы-фильтры, новые колонки,
 *     плашка «Требуют исправления»;
 *   • карточка заказа: тип, назначение строк, причина отмены, «Слить с ORD-…»;
 *   • карточка договора: блок «Закупка по договору».
 */
(function (root) {
  'use strict';

  const SC_KINDS = [['goods', 'Товар', 'package'], ['mfg', 'Изготовление', 'building-factory-2'], ['service', 'Услуга', 'briefcase']];
  const SC_DESTS = [['contract', 'Договор', 'file-text'], ['stock', 'Склад', 'building-warehouse'], ['shop', 'Цех', 'tool']];
  const SC_STEPS = ['запрос', 'счёт', 'на опл.', 'оплачен', 'едет', 'частич.', 'пришло'];
  const SC_STATUS = {
    draft: 'Черновик', invoice_requested: 'Запрос счёта', sent: 'Запрос счёта', awaiting_invoice: 'Запрос счёта',
    invoice_received: 'Счёт получен', approval: 'На согласовании', to_pay: 'На оплату', paid: 'Оплачен',
    shipping: 'Едет', partial: 'Пришло частично', received: 'Пришло', closed: 'Оприходовано', cancelled: 'Отменён',
  };
  const SC_STEP_OF = { draft: -1, invoice_requested: 0, sent: 0, awaiting_invoice: 0, invoice_received: 1, approval: 1,
    to_pay: 2, paid: 3, shipping: 4, partial: 5, received: 6, closed: 6 };

  function esc(s) {
    if (typeof root.escapeHtml === 'function') return root.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // Глобальные const/let из app-1/app-3 (не свойства window) — читаем через typeof
  function G(name) {
    switch (name) {
      case 'cache': return typeof cache !== 'undefined' ? cache : null;
      case 'state': return typeof state !== 'undefined' ? state : null;
      case '_owz': return typeof _owz !== 'undefined' ? _owz : null;
      case 'API_BASE': return typeof API_BASE !== 'undefined' ? API_BASE : '';
      case 'TOKEN_KEY': return typeof TOKEN_KEY !== 'undefined' ? TOKEN_KEY : 'atomus_token';
      case '_payInvoiceFile': return typeof _payInvoiceFile !== 'undefined' ? _payInvoiceFile : null;
    }
    return null;
  }
  function money(n) {
    const x = Number(n);
    if (!isFinite(x)) return '—';
    return x.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
  }
  function ddmm(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[3] + '.' + m[2]) : '';
  }

  // ---------------------------------------------------------------- назначение
  /** Назначение строки валидно: тип из трёх, у «договора» — выбран договор. */
  function scItemDestOk(it) {
    if (!it) return false;
    const t = it.dest_type;
    if (t !== 'contract' && t !== 'stock' && t !== 'shop') return false;
    return t !== 'contract' || !!it.dest_contract_id;
  }
  /** Сколько строк без назначения (кнопка «Отправить» неактивна, пока > 0). */
  function scMissingDest(list) {
    return (list || []).filter(x => !scItemDestOk(x)).length;
  }
  /** Массовое присвоение: ids = null → всем строкам. Возвращает число изменённых. */
  function scApplyBulk(list, ids, destType, contractId, contractNumber) {
    let n = 0;
    const want = ids ? new Set(ids.map(String)) : null;
    (list || []).forEach(x => {
      if (want && !want.has(String(x.id))) return;
      x.dest_type = destType;
      x.dest_contract_id = destType === 'contract' ? (contractId || null) : null;
      x.dest_contract_number = destType === 'contract' ? (contractNumber || '') : '';
      n++;
    });
    return n;
  }
  /** Чип назначения: «№24ТД/10.26» / «Склад» / «Цех» / красный «Не выбрано». */
  function scDestChipHtml(destType, contractNumber, onclick) {
    const click = onclick ? ' role="button" tabindex="0" onclick="' + onclick + '"' : '';
    if (destType === 'contract' && contractNumber) {
      const num = String(contractNumber).replace(/^№\s*/, '');
      return '<span class="sc-chip sc-chip-contract"' + click + '><i class="ti ti-file-text"></i>№' + esc(num) + '</span>';
    }
    if (destType === 'stock') return '<span class="sc-chip"' + click + '><i class="ti ti-building-warehouse"></i>Склад</span>';
    if (destType === 'shop') return '<span class="sc-chip"' + click + '><i class="ti ti-tool"></i>Цех</span>';
    return '<span class="sc-chip sc-chip-bad"' + click + '><i class="ti ti-alert-triangle"></i>Не выбрано</span>';
  }
  /** Степпер из 7 шагов (макет s1): пройденные — тёмные, текущий — цветной. */
  function scStepperHtml(step, status) {
    const cur = typeof step === 'number' ? step : (SC_STEP_OF[status] != null ? SC_STEP_OF[status] : -1);
    const warn = status === 'invoice_requested' || status === 'sent' || status === 'awaiting_invoice';
    let h = '<div class="sc-steps">';
    SC_STEPS.forEach((lbl, i) => {
      const cls = i < cur ? 'done' : (i === cur ? ('now' + (warn ? ' warn' : (cur === 3 ? ' paid' : ''))) : '');
      h += '<div class="sc-step ' + cls + '"><span class="bar"></span><span class="lbl">' + esc(lbl) + '</span></div>';
    });
    return h + '</div>';
  }
  function scKindLabel(k) { const x = SC_KINDS.find(v => v[0] === k); return x ? x[1] : ''; }

  // ---------------------------------------------------------------- «Ждём поставку»
  const scWait = { data: null, stuck: null, group: (root.localStorage && localStorage.getItem('sc_wait_group')) || 'contract' };

  function _scWaitDueHtml(it) {
    if (it.expected_date) return '<span class="sc-due">придёт ' + esc(ddmm(it.expected_date)) + '</span>';
    if (it.step <= 0) return '<span class="sc-due bad">счёта нет · ' + Number(it.days_in_step || 0) + ' дн</span>';
    if (it.step >= 3) return '<span class="sc-due warn">' + (it.step === 3 ? 'нет даты' : 'когда придёт?') + ' · ' + Number(it.days_in_step || 0) + ' дн</span>';
    return '<span class="sc-due">' + esc(it.status_label || '') + ' · ' + Number(it.days_in_step || 0) + ' дн</span>';
  }
  function scWaitRowHtml(it) {
    const qty = (Number(it.remaining) || 0) + ' ' + esc(it.unit || 'шт.');
    return '<div class="sc-wrow" data-oi="' + Number(it.order_item_id) + '">' +
      '<div class="sc-wrow-top"><div class="sc-wrow-name" role="button" tabindex="0" onclick="openSupplyOrder(' + Number(it.order_id) + ')">' + esc(it.name) + '</div>' + _scWaitDueHtml(it) + '</div>' +
      '<div class="sc-wrow-meta">' + esc(it.supplier_name || '—') + ' · ' + esc(it.order_label || '') + ' · ' + qty + '</div>' +
      '<div class="sc-wrow-chip">' + scDestChipHtml(it.dest_type, it.dest_contract_number,
        scItemDestOk(it) ? '' : ('scOpenDestPicker(' + Number(it.order_id) + ',[' + Number(it.order_item_id) + '])')) +
        (it.can_stock_in ? '' : '<span class="sc-chip sc-chip-muted" title="Позиции нет в справочнике комплектующих — «Отметить, что пришло» в карточке заказа"><i class="ti ti-package-off"></i>без компонента</span>') +
      '</div>' +
      scStepperHtml(it.step, it.status) +
    '</div>';
  }
  /** Группы для «Ждём поставку»: по договору (+Склад, Цех, Без назначения) или по поставщику. */
  function scGroupWaiting(items, mode) {
    const groups = new Map();
    (items || []).forEach(it => {
      let key, title, order;
      if (mode === 'supplier') {
        key = 's' + (it.supplier_id || 0) + ':' + (it.supplier_id ? '' : it.supplier_name);
        title = it.supplier_name || 'Поставщик не определён';
        order = it.supplier_id ? 1 : 2;
      } else if (it.dest_type === 'contract' && it.dest_contract_id) {
        key = 'c' + it.dest_contract_id;
        title = 'Договор № ' + String(it.dest_contract_number || '').replace(/^№\s*/, '') + (it.dest_contractor_name ? ' · ' + it.dest_contractor_name : '');
        order = 0;
      } else if (it.dest_type === 'stock') { key = 'stock'; title = 'Склад'; order = 1; }
      else if (it.dest_type === 'shop') { key = 'shop'; title = 'Цех · инструмент'; order = 2; }
      else { key = 'none'; title = 'Без назначения'; order = 3; }
      if (!groups.has(key)) groups.set(key, { key, title, order, items: [] });
      groups.get(key).items.push(it);
    });
    return Array.from(groups.values()).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ru'));
  }
  function scWaitPaneHtml(data, mode) {
    const items = (data && data.items) || [];
    const noItems = (data && data.no_items) || [];
    let h = '<div class="sc-seg2">' +
      '<button class="' + (mode !== 'supplier' ? 'on' : '') + '" onclick="scSetWaitGroup(\'contract\')">По договору</button>' +
      '<button class="' + (mode === 'supplier' ? 'on' : '') + '" onclick="scSetWaitGroup(\'supplier\')">По поставщику</button>' +
    '</div>';
    if (!items.length && !noItems.length) {
      return h + '<div class="empty-block" style="padding:28px 16px;"><i class="ti ti-mood-smile" style="color:#16A34A;font-size:26px;"></i>' +
        '<div style="margin-top:8px;font-size:14px;color:var(--text-mid);">Ничего не ждём — все оформленные заказы пришли.</div></div>';
    }
    scGroupWaiting(items, mode).forEach(g => {
      const fix = g.key === 'none'
        ? '<button class="sc-link" onclick="scAssignGroup(' + esc(JSON.stringify(g.items.map(i => [i.order_id, i.order_item_id]))) + ')"><i class="ti ti-arrows-exchange"></i> Назначить</button>'
        : '';
      h += '<div class="sc-group"><div class="sc-group-head"><span class="t">' + esc(g.title) + '</span><span class="n">' + g.items.length + '</span>' + fix + '</div>' +
        '<div class="sc-card">' + g.items.map(scWaitRowHtml).join('') + '</div></div>';
    });
    if (noItems.length) {
      h += '<div class="sc-group"><div class="sc-group-head"><span class="t">Счета без позиций</span><span class="n">' + noItems.length + '</span>' +
        '<span class="sc-hint">переходный период — откройте и заполните «Что в счёте?»</span></div><div class="sc-card">' +
        noItems.map(n => '<div class="sc-wrow sc-wrow-noitems" role="button" tabindex="0" onclick="openSupplyOrder(' + Number(n.order_id) + ')">' +
          '<div class="sc-wrow-top"><div class="sc-wrow-name">' + esc(n.order_label) + ' · ' + esc(n.supplier_name || '—') + '</div>' +
          '<span class="sc-due">' + esc(n.status_label || '') + (n.invoice_total ? ' · ' + money(n.invoice_total) : '') + '</span></div>' +
          '<div class="sc-wrow-meta">' + (n.invoice_number ? 'счёт № ' + esc(n.invoice_number) : 'без номера счёта') +
          (n.invoice_items_count ? ' · в счёте ' + Number(n.invoice_items_count) + ' поз.' : '') + '</div></div>').join('') +
      '</div></div>';
    }
    return h;
  }
  function scStuckPaneHtml(st) {
    const items = (st && st.items) || [];
    let h = '';
    if (!items.length) {
      h += '<div class="empty-block" style="padding:28px 16px;"><i class="ti ti-circle-check" style="color:#16A34A;font-size:26px;"></i>' +
        '<div style="margin-top:8px;font-size:14px;color:var(--text-mid);">Зависших заказов нет.</div></div>';
    } else {
      h += '<div class="sc-card">' + items.map(x =>
        '<div class="sc-wrow">' +
          '<div class="sc-wrow-top"><div class="sc-wrow-name" role="button" tabindex="0" onclick="openSupplyOrder(' + Number(x.order_id) + ')">' +
            esc(x.order_label) + ' · ' + esc(x.supplier_name || '—') + '</div>' +
            '<span class="sc-due bad">' + Number(x.days_in_step || 0) + ' дн</span></div>' +
          '<div class="sc-wrow-meta">' + (x.rule_labels || []).map(r => '<span class="sc-rule">' + esc(r) + '</span>').join(' ') +
            ' · сообщаем ' + esc((x.who || []).join(', ')) + '</div>' +
          scStepperHtml(x.step, x.status) +
          ((x.rules || []).some(r => ['no_invoice', 'paid_no_date', 'overdue', 'partial'].includes(r))
            ? '<button class="btn btn-secondary btn-small" style="margin-top:8px;" onclick="scReminderDraft(' + Number(x.order_id) + ')"><i class="ti ti-bell"></i> Напомнить поставщику</button>'
            : '') +
        '</div>').join('') + '</div>';
    }
    const toSort = (st && st.to_sort) || [];
    if (toSort.length) {
      h += '<div class="sc-group"><div class="sc-group-head"><span class="t">Разобрать: не указан тип закупки</span><span class="n">' + toSort.length + '</span></div>' +
        '<div class="sc-card">' + toSort.slice(0, 50).map(x =>
          '<div class="sc-wrow" role="button" tabindex="0" onclick="openSupplyOrder(' + Number(x.order_id) + ')"><div class="sc-wrow-top"><div class="sc-wrow-name">' +
          esc(x.order_label) + ' · ' + esc(x.supplier_name || '—') + '</div><span class="sc-due">' + esc(x.status_label || '') + '</span></div></div>').join('') +
        (toSort.length > 50 ? '<div class="sc-wrow-meta" style="padding:8px 12px;">… и ещё ' + (toSort.length - 50) + '</div>' : '') +
      '</div></div>';
    }
    return h;
  }

  async function scLoadWaiting() {
    try {
      const [w, s] = await Promise.all([
        root.apiGet('/api/supply/waiting'),
        root.apiGet('/api/supply/stuck?short=1').catch(() => null),
      ]);
      scWait.data = w; scWait.stuck = s;
    } catch (e) { scWait.data = scWait.data || { items: [], no_items: [] }; }
    scPaintShopping();
  }
  function scPaintShopping() {
    const box = document.getElementById('sup-shop-content');
    if (!box) return;
    const seg = box.querySelector('.sup-seg');
    if (seg && !seg.querySelector('[data-tab="stuck"]')) {
      const b = document.createElement('button');
      b.setAttribute('data-tab', 'stuck');
      b.setAttribute('onclick', "supSwitchTab('stuck')");
      b.innerHTML = '<i class="ti ti-alert-octagon"></i> Зависли <span class="cnt">0</span>';
      seg.appendChild(b);
    }
    let stuckPane = box.querySelector('.sup-pane[data-pane="stuck"]');
    const waitPane = box.querySelector('.sup-pane[data-pane="wait"]');
    if (!stuckPane && waitPane) {
      stuckPane = document.createElement('div');
      stuckPane.className = 'sup-pane';
      stuckPane.setAttribute('data-pane', 'stuck');
      stuckPane.hidden = root._supTab !== 'stuck';
      waitPane.parentNode.insertBefore(stuckPane, waitPane.nextSibling);
    }
    const w = scWait.data;
    if (w) {
      const n = (w.items || []).length;
      const wb = seg && seg.querySelector('[data-tab="wait"] .cnt');
      if (wb) wb.textContent = n;
      box.querySelectorAll('.sup-kpi').forEach(k => {
        if ((k.getAttribute('onclick') || '').indexOf("'wait'") >= 0) { const num = k.querySelector('.sup-kpi-num'); if (num) num.textContent = n; }
      });
      if (waitPane && (root._supWaitFilter || 'all') === 'all') waitPane.innerHTML = scWaitPaneHtml(w, scWait.group);
    }
    if (scWait.stuck) {
      const sb = seg && seg.querySelector('[data-tab="stuck"] .cnt');
      if (sb) sb.textContent = scWait.stuck.count || 0;
      if (stuckPane) stuckPane.innerHTML = scStuckPaneHtml(scWait.stuck);
    }
    if (root._supTab === 'stuck' && typeof root.supSwitchTab === 'function') root.supSwitchTab('stuck');
  }
  function scSetWaitGroup(mode) {
    scWait.group = mode === 'supplier' ? 'supplier' : 'contract';
    try { localStorage.setItem('sc_wait_group', scWait.group); } catch (e) {}
    scPaintShopping();
  }

  async function scReminderDraft(orderId) {
    let d;
    try { d = await root.apiGet('/api/supply/stuck/' + Number(orderId) + '/reminder-draft'); }
    catch (e) { root.showToast('Не удалось подготовить письмо', 'error'); return; }
    const old = document.getElementById('sc-remind-modal'); if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = 'sc-remind-modal'; ov.className = 'modal-overlay visible';
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    const mailto = 'mailto:' + encodeURIComponent(d.to || '') + '?subject=' + encodeURIComponent(d.subject || '') + '&body=' + encodeURIComponent(d.body || '');
    ov.innerHTML = '<div class="modal" style="max-width:520px;" onclick="event.stopPropagation()">' +
      '<div class="modal-header"><h3><i class="ti ti-bell"></i> Напомнить поставщику</h3>' +
      '<button class="icon-btn" onclick="document.getElementById(\'sc-remind-modal\').remove()"><i class="ti ti-x"></i></button></div>' +
      '<div class="modal-body"><div class="sc-hint" style="margin-bottom:8px;">Это черновик. Письмо само не уходит — проверьте и отправьте из почты.</div>' +
      '<div class="sc-hint">Кому: <b>' + esc(d.to || 'email не указан') + '</b></div>' +
      '<div class="sc-hint">Тема: <b>' + esc(d.subject || '') + '</b></div>' +
      '<textarea id="sc-remind-body" rows="9" style="width:100%;margin-top:8px;box-sizing:border-box;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13.5px;">' + esc(d.body || '') + '</textarea></div>' +
      '<div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn btn-secondary" onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById(\'sc-remind-body\').value);showToast(\'Текст скопирован\',\'success\')"><i class="ti ti-copy"></i> Скопировать</button>' +
        '<a class="btn btn-primary" href="' + esc(mailto) + '"><i class="ti ti-mail"></i> Открыть в почте</a>' +
      '</div></div>';
    document.body.appendChild(ov);
  }

  // Назначение строк заказа из «Ждём поставку» / карточки заказа
  let _scContracts = null;
  async function scContracts() {
    if (_scContracts) return _scContracts;
    try {
      let list = (G('cache') && G('cache').contracts) || null;
      if (!list) {
        const d = await root.apiGet('/api/contracts?limit=500');
        list = d.contracts || [];
        if (G('cache')) G('cache').contracts = list;
      }
      _scContracts = list.filter(c => !['closed', 'cancelled', 'archived'].includes(String(c.status || '')));
    } catch (e) { _scContracts = []; }
    return _scContracts;
  }
  function scContractOptionsHtml(list, selected) {
    return '<option value="">— выберите договор —</option>' + (list || []).map(c =>
      '<option value="' + Number(c.id) + '"' + (Number(selected) === Number(c.id) ? ' selected' : '') + '>' +
      esc((c.number ? (String(c.number).trim().startsWith('№') ? c.number : '№ ' + c.number) : '#' + c.id) + (c.contractor_name ? ' · ' + c.contractor_name : '')) + '</option>').join('');
  }
  /**
   * Выбор «Куда»: Договор / Склад / Цех.
   * orderId — один id или массив id (массово: каждому заказу «всё → …»).
   * itemIds — только эти строки (одного заказа); пусто — все строки и сам заказ.
   * cur — текущее назначение {type, contract_id} для подстановки.
   * opts.labels — подписи заказов для заголовка (ORD-…).
   */
  async function scOpenDestPicker(orderId, itemIds, onDone, cur, opts) {
    const ids = (Array.isArray(orderId) ? orderId : [orderId]).map(Number).filter(Boolean);
    if (!ids.length) return;
    cur = cur || {};
    opts = opts || {};
    const list = await scContracts();
    const old = document.getElementById('sc-dest-modal'); if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = 'sc-dest-modal'; ov.className = 'modal-overlay visible';
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    const startType = SC_DESTS.some(d => d[0] === cur.type) ? cur.type : 'contract';
    const what = ids.length > 1 ? ids.length + ' ' + (ids.length < 5 ? 'заказа' : 'заказов')
      : (itemIds && itemIds.length ? itemIds.length + ' поз.' : (opts.labels && opts.labels[0]) || ('ORD-' + ids[0]));
    const labels = (opts.labels || []).filter(Boolean);
    ov.innerHTML = '<div class="modal" style="max-width:460px;" onclick="event.stopPropagation()">' +
      '<div class="modal-header"><h3><i class="ti ti-map-pin"></i> Куда · ' + esc(what) + '</h3>' +
      '<button class="icon-btn" onclick="document.getElementById(\'sc-dest-modal\').remove()"><i class="ti ti-x"></i></button></div>' +
      '<div class="modal-body">' +
      (labels.length > 1 ? '<div class="sc-sub" style="margin-bottom:8px;">' + esc(labels.join(', ')) + ' — всем позициям сразу</div>' : '') +
      (opts.note ? '<div class="sc-sub" style="margin-bottom:8px;">' + esc(opts.note) + '</div>' : '') +
      scDestSegHtml('scdp', startType) +
      '<select id="scdp-contract" class="sc-select" style="margin-top:10px;' + (startType === 'contract' ? '' : 'display:none;') + '">' + scContractOptionsHtml(list, cur.contract_id || null) + '</select>' +
      '<div id="scdp-err" class="sc-err" style="display:none;"></div></div>' +
      '<div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'sc-dest-modal\').remove()">Отмена</button>' +
        '<button class="btn btn-primary" id="scdp-save"><i class="ti ti-check"></i> Сохранить</button></div></div>';
    document.body.appendChild(ov);
    const seg = document.getElementById('scdp'); if (seg) seg.setAttribute('data-value', startType);
    root._scOnSeg_scdp = v => { const sel = document.getElementById('scdp-contract'); if (sel) sel.style.display = v === 'contract' ? '' : 'none'; };
    document.getElementById('scdp-save').onclick = async () => {
      const err = document.getElementById('scdp-err');
      const dt = scSegValue('scdp') || 'contract';
      const cid = dt === 'contract' ? Number((document.getElementById('scdp-contract') || {}).value || 0) : null;
      if (dt === 'contract' && !cid) { err.style.display = ''; err.textContent = 'Выберите договор'; return; }
      const btn = document.getElementById('scdp-save'); btn.disabled = true;
      let fail = 0, lastMsg = '';
      for (const id of ids) {
        const one = ids.length === 1 && itemIds && itemIds.length;
        const r = await root.apiPost('/api/supply-orders/' + id + '/dest',
          { dest_type: dt, contract_id: cid, item_ids: one ? itemIds : [], all: !one });
        if (!r || !r.ok) { fail++; lastMsg = (r && r.data && r.data.message) || 'Не удалось'; }
      }
      btn.disabled = false;
      if (fail === ids.length) { err.style.display = ''; err.textContent = lastMsg; return; }
      ov.remove();
      root.showToast(fail ? ('Сохранено, но не у всех: ошибок ' + fail) : ('«Куда» сохранено' + (ids.length > 1 ? ' · ' + ids.length + ' заказов' : '')), fail ? 'warning' : 'success');
      if (typeof onDone === 'function') onDone(); else scLoadWaiting();
    };
  }
  async function scAssignGroup(pairs) {
    const byOrder = {};
    (pairs || []).forEach(p => { (byOrder[p[0]] = byOrder[p[0]] || []).push(p[1]); });
    const ids = Object.keys(byOrder);
    if (ids.length === 1) return scOpenDestPicker(Number(ids[0]), byOrder[ids[0]]);
    root.showToast('Строки из ' + ids.length + ' заказов — назначьте в каждом заказе', 'info');
    return scOpenDestPicker(Number(ids[0]), byOrder[ids[0]]);
  }

  // v2.46.296: выбор типа закупки временно скрыт во всём UI (оплата,
  // «Загрузить счёт», мастер «Оформить заказ», чипы в карточке заказа).
  // Поле kind в БД и логика статусов НЕ удаляются. Вернуть выбор:
  // SC_FLAGS.hidePurchaseKind = false.
  // Без типа подставляем «товар» (самый частый в базе на 10.11.2026:
  // goods 166, mfg 102, service 45). «Услугу» по умолчанию нельзя —
  // после оплаты такой заказ сразу закрывается. Уже указанный тип не трогаем.
  const SC_PAYMENT_DEFAULT_KIND = 'goods';
  const SC_PAYMENT_DEFAULT_DEST = 'stock';
  if (!root.SC_FLAGS) {
    root.SC_FLAGS = {
      hidePurchaseKind: true,
      defaultKind: SC_PAYMENT_DEFAULT_KIND,
      defaultDest: SC_PAYMENT_DEFAULT_DEST,
    };
  }
  const SC_FLAGS = root.SC_FLAGS;
  function scHidePurchaseKind() { return !!SC_FLAGS.hidePurchaseKind; }
  function scPaymentKind(order) {
    return SC_KINDS.some(k => k[0] === (order && order.kind)) ? order.kind : SC_PAYMENT_DEFAULT_KIND;
  }
  function scPaymentNeedsDest(order, kind) {
    if (!['goods', 'mfg'].includes(kind) || order.chain_new === false) return false;
    const items = order.items || [];
    return items.length ? scMissingDest(items) > 0
      : !scItemDestOk({dest_type: order.dest_type, dest_contract_id: order.contract_id});
  }
  async function scFillPaymentDefaults(order) {
    const kind = scPaymentKind(order);
    const kindWasSet = SC_KINDS.some(k => k[0] === order.kind);
    const save = async (path, body) => {
      await root.scPost('/api/supply-orders/' + Number(order.id) + path, body);
      if (G('cache')) G('cache').supplyOrders = null;
    };
    if (!kindWasSet) {
      await save('/kind', {kind});
      order.kind = kind;
    }
    if (!scPaymentNeedsDest(order, kind)) return;
    const items = order.items || [];
    const missing = items.filter(it => !scItemDestOk(it)).map(it => it.id);
    const dest = SC_FLAGS.defaultDest || SC_PAYMENT_DEFAULT_DEST;
    if (missing.length) {
      await save('/dest', {dest_type: dest, item_ids: missing, all: false});
      items.forEach(it => { if (missing.indexOf(it.id) >= 0) { it.dest_type = dest; it.dest_contract_id = null; } });
    } else if (!items.length) {
      await save('/dest', {dest_type: dest, item_ids: [], all: false});
      order.dest_type = dest;
    }
  }
  async function scCompletePaymentDetails(orderId) {
    if (document.getElementById('sc-payment-details')) return false;
    const order = await root.apiGet('/api/supply-orders/' + Number(orderId));
    if (document.getElementById('sc-payment-details')) return false;
    if (scHidePurchaseKind()) {
      try { await scFillPaymentDefaults(order); return true; }
      catch (e) {
        if (typeof root.showToast === 'function') {
          root.showToast((e && e.message) || 'Не удалось сохранить данные счёта', 'error');
        }
        return false;
      }
    }
    const contracts = await scContracts();
    if (document.getElementById('sc-payment-details')) return false;
    const kind = scPaymentKind(order);
    const kindWasSet = SC_KINDS.some(k => k[0] === order.kind);
    const saveKind = async (body) => {
      await root.scPost('/api/supply-orders/' + Number(orderId) + '/kind', body);
      if (G('cache')) G('cache').supplyOrders = null;
    };
    if (!scPaymentNeedsDest(order, kind)) {
      if (kindWasSet) return true;
      try { await saveKind({kind}); return true; }
      catch (e) {
        if (typeof root.showToast === 'function') {
          root.showToast((e && e.message) || 'Не удалось сохранить тип закупки', 'error');
        }
        return false;
      }
    }
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.id = 'sc-payment-details'; modal.className = 'modal-overlay visible';
      let busy = false;
      const close = value => {
        document.removeEventListener('keydown', onKey, true);
        modal.remove(); resolve(value);
      };
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) close(false); }
      };
      modal.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="sc-payment-title" style="max-width:540px;max-height:90vh;display:flex;flex-direction:column;">' +
        '<div class="modal-header"><h3 id="sc-payment-title">Уточнить счёт перед отметкой оплаты</h3></div>' +
        '<div class="modal-body" style="overflow-y:auto;">' +
        '<p><b>' + esc(order.order_label || ('ORD-' + orderId)) + '</b> · ' + esc(order.supplier_name || '') + '</p>' +
        (order.purpose ? '<p>' + esc(order.purpose) + '</p>' : '') +
        '<p class="sc-sub">В счёте не указано, куда закупаем. Выберите назначение — оно заполнится только у строк, где ещё не указано. Затем продолжится подтверждение оплаты.</p>' +
        '<fieldset style="border:0;padding:0;margin:0;">' +
        '<div id="sc-payment-dest-wrap"><label for="sc-payment-dest" class="sc-lbl">Куда закупаем</label>' +
        '<select id="sc-payment-dest" class="sc-select" style="width:100%;margin:6px 0 10px;">' +
        '<option value="">— выберите назначение —</option>' + SC_DESTS.map(d => '<option value="' + d[0] + '"' + (order.dest_type === d[0] ? ' selected' : '') + '>' + d[1] + '</option>').join('') + '</select>' +
        '<label id="sc-payment-contract-wrap" class="sc-lbl">Договор<select id="sc-payment-contract" class="sc-select" style="width:100%;margin:6px 0 10px;">' + scContractOptionsHtml(contracts, order.contract_id) + '</select></label></div></fieldset>' +
        '<div id="sc-payment-error" class="sc-err" role="alert" style="display:none;"></div></div>' +
        '<div class="modal-footer" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;">' +
        '<button type="button" class="btn btn-secondary" id="sc-payment-cancel">Отмена</button>' +
        '<button type="button" class="btn btn-primary" id="sc-payment-save">Сохранить и продолжить</button></div></div>';
      document.body.appendChild(modal);
      const el = id => modal.querySelector('#sc-payment-' + id);
      const showError = message => { el('error').textContent = message; el('error').style.display = ''; };
      const paint = () => {
        el('error').style.display = 'none';
        el('contract-wrap').style.display = el('dest').value === 'contract' ? '' : 'none';
      };
      el('dest').onchange = paint; paint();
      el('contract').onchange = () => { el('error').style.display = 'none'; };
      el('cancel').onclick = () => { if (!busy) close(false); };
      modal.onclick = e => { if (e.target === modal && !busy) close(false); };
      document.addEventListener('keydown', onKey, true);
      el('save').onclick = async () => {
        if (busy) return;
        const dest = el('dest').value, cid = Number(el('contract').value) || null;
        if (!SC_DESTS.some(d => d[0] === dest)) { showError('Выберите, куда закупаем'); return; }
        if (dest === 'contract' && !cid) { showError('Выберите договор'); return; }
        const body = {kind, dest_type: dest, contract_id: dest === 'contract' ? cid : null};
        busy = true; el('save').disabled = true; el('cancel').disabled = true;
        modal.querySelector('fieldset').disabled = true;
        el('error').style.display = 'none';
        try {
          await saveKind(body);
          close(true);
        } catch (e) {
          busy = false; el('save').disabled = false; el('cancel').disabled = false;
          modal.querySelector('fieldset').disabled = false;
          showError((e && e.message) || 'Не удалось сохранить данные счёта');
        }
      };
      el('dest').focus();
    });
  }

  // Сегмент-переключатель (Тип / Куда)
  function scKindSegHtml(prefix, value) {
    if (scHidePurchaseKind()) {
      const v = SC_KINDS.some(k => k[0] === value) ? value : (SC_FLAGS.defaultKind || SC_PAYMENT_DEFAULT_KIND);
      return '<div id="' + prefix + '-kind" data-value="' + v + '" hidden style="display:none"></div>';
    }
    return '<div class="sc-seg" id="' + prefix + '-kind">' + SC_KINDS.map(k =>
      '<button type="button" data-v="' + k[0] + '" class="' + (value === k[0] ? 'on' : '') + '" onclick="scSegPick(\'' + prefix + '-kind\',\'' + k[0] + '\')">' + esc(k[1]) + '</button>').join('') + '</div>';
  }
  function scDestSegHtml(prefix, value) {
    return '<div class="sc-seg" id="' + prefix + '">' + SC_DESTS.map(k =>
      '<button type="button" data-v="' + k[0] + '" class="' + (value === k[0] ? 'on' : '') + '" onclick="scSegPick(\'' + prefix + '\',\'' + k[0] + '\')"><i class="ti ti-' + k[2] + '"></i> ' + esc(k[1]) + '</button>').join('') + '</div>';
  }
  function scSegPick(id, v) {
    const seg = document.getElementById(id);
    if (!seg) return;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.getAttribute('data-v') === v));
    seg.setAttribute('data-value', v);
    const ev = root['_scOnSeg_' + id.replace(/-/g, '_')];
    if (typeof ev === 'function') ev(v);
  }
  function scSegValue(id) {
    const seg = document.getElementById(id);
    if (!seg) return null;
    const on = seg.querySelector('button.on');
    return on ? on.getAttribute('data-v') : (seg.getAttribute('data-value') || null);
  }

  /** в.9: строки распознанного счёта — предложение; номенклатура не создаётся без подтверждения. */
  function scInvLinesHtml(orderId, lines) {
    const pend = (lines || []).filter(l => !l.added);
    if (!pend.length) return '';
    return '<div class="sc-invlines" id="sc-invlines-' + Number(orderId) + '">' +
      '<div class="sc-oc-row"><span class="sc-oc-l">Строки из счёта</span><span class="sc-sub">распознано ' + pend.length +
      ' — проверьте и добавьте в заказ; новые позиции номенклатуры заводятся только по вашей галочке</span></div>' +
      pend.map(l => {
        const m = l.match_item_id;
        return '<label class="sc-invline" data-idx="' + Number(l.idx) + '"' + (m ? ' data-item="' + Number(m) + '"' : '') + '>' +
          '<input type="checkbox"' + (m ? ' checked' : '') + '> ' +
          '<span class="sc-oc-name">' + esc(l.name) + '</span> <span class="sc-sub">' + esc(String(l.qty || 1)) + ' ' + esc(l.unit || '') +
          (l.price ? ' · ' + money(l.price) : '') + '</span> ' +
          (m ? '<span class="sc-chip">в номенклатуре: ' + esc(l.match_name || '') + '</span>'
             : '<span class="sc-chip sc-chip-warn">новая — завести в номенклатуру</span>') +
          '</label>';
      }).join('') +
      '<div class="sc-oc-row"><button class="btn btn-secondary btn-small" onclick="scInvLinesAccept(' + Number(orderId) + ')"><i class="ti ti-check"></i> Добавить выбранные</button></div></div>';
  }

  const api = {
    scPaymentNeedsDest, scCompletePaymentDetails, scFillPaymentDefaults, scPaymentKind,
    scHidePurchaseKind, SC_PAYMENT_DEFAULT_KIND, SC_PAYMENT_DEFAULT_DEST, SC_FLAGS,
    scInvLinesHtml,
    SC_KINDS, SC_DESTS, SC_STEPS, SC_STATUS, SC_STEP_OF,
    scItemDestOk, scMissingDest, scApplyBulk, scDestChipHtml, scStepperHtml, scKindLabel,
    scGroupWaiting, scWaitPaneHtml, scWaitRowHtml, scStuckPaneHtml,
    scLoadWaiting, scPaintShopping, scSetWaitGroup, scReminderDraft,
    scContracts, scContractOptionsHtml, scOpenDestPicker, scAssignGroup, _G: G, __scWaitData: () => scWait.data,
    scKindSegHtml, scDestSegHtml, scSegPick, scSegValue, _esc: esc, _money: money,
  };
  Object.keys(api).forEach(k => { root[k] = api[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* ---------------------------------------------------------------------------
 * Подключение к экранам app-3.js (обёртки; исходные функции остаются).
 * ------------------------------------------------------------------------- */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  const esc = root._esc, money = root._money, G = root._G;

  function wrap(name, after) {
    const orig = root[name];
    if (typeof orig !== 'function' || orig._sc283) return;
    const fn = function () {
      const res = orig.apply(this, arguments);
      if (res && typeof res.then === 'function') return res.then(v => { try { after.apply(this, arguments); } catch (e) { console.warn(name, e); } return v; });
      try { after.apply(this, arguments); } catch (e) { console.warn(name, e); }
      return res;
    };
    fn._sc283 = true;
    fn._orig = orig;
    root[name] = fn;
  }

  // ---------- «Что закупить» → «Ждём поставку» / «Зависли»
  wrap('renderSupplyShopping', function () { root.scPaintShopping(); root.scLoadWaiting(); });
  const _origWaitPane = root._supRenderWaitPane;
  if (typeof _origWaitPane === 'function') {
    root._supRenderWaitPane = function () {
      const pane = document.querySelector('#sup-shop-content .sup-pane[data-pane="wait"]');
      const f = root._supWaitFilter || 'all';
      const st = root.__scWaitData ? root.__scWaitData() : null;
      if (pane && f === 'all' && st) {
        pane.innerHTML = root.scWaitPaneHtml(st, localStorage.getItem('sc_wait_group') || 'contract');
        return;
      }
      return _origWaitPane.apply(this, arguments);
    };
  }

  // ---------- «Оформить заказ»: Тип, Куда, договор, чип у строки, массово
  function owz() { return G('_owz') || {}; }
  root._scOnSeg_owz_kind = function (v) { owz().kind = v; scOwzPaint(); };
  root._scOnSeg_owz_dest = function (v) {
    const o = owz(); o.dest = v;
    const sel = document.getElementById('owz-dest-contract');
    if (sel) sel.style.display = v === 'contract' ? '' : 'none';
    // строки без назначения получают назначение заказа
    (o.list || []).forEach(x => { if (!root.scItemDestOk(x)) { x.dest_type = v; x.dest_contract_id = v === 'contract' ? o.contractId : null; x.dest_contract_number = v === 'contract' ? o.contractNumber : ''; } });
    root._owzRenderCart();
  };
  root.scOwzContract = function (sel) {
    const o = owz();
    o.contractId = Number(sel.value) || null;
    o.contractNumber = o.contractId ? ((sel.options[sel.selectedIndex] || {}).getAttribute('data-num') || '') : '';
    (o.list || []).forEach(x => { if (x.dest_type === 'contract' && !x.dest_contract_id) { x.dest_contract_id = o.contractId; x.dest_contract_number = o.contractNumber; } });
    root._owzRenderCart();
  };
  wrap('openNewSupplyOrder', async function () {
    const content = document.querySelector('#supply-modal .owz2 .modal-content');
    if (!content || document.getElementById('owz-kind')) return;
    const o = owz();
    if (root.scHidePurchaseKind()) o.kind = o.kind || root.SC_PAYMENT_DEFAULT_KIND;
    else o.kind = o.kind || null;
    o.dest = o.dest || null;
    const list = await root.scContracts();
    const box = document.createElement('div');
    box.className = 'sc-owz-head';
    box.innerHTML =
      (root.scHidePurchaseKind() ? '' : '<div class="owz2-sec-l"><i class="ti ti-category"></i> Тип · обязательно</div>') +
      root.scKindSegHtml('owz', o.kind) +
      '<div class="owz2-sec-l"><i class="ti ti-map-pin"></i> Куда · обязательно</div>' + root.scDestSegHtml('owz-dest', o.dest) +
      '<select id="owz-dest-contract" class="sc-select" style="margin-top:8px;' + (o.dest === 'contract' ? '' : 'display:none;') + '" onchange="scOwzContract(this)">' +
        '<option value="">— выберите договор —</option>' + list.map(c => '<option value="' + Number(c.id) + '" data-num="' + esc(c.number || '') + '">' +
          esc((c.number ? (String(c.number).trim().startsWith('№') ? c.number : '№ ' + c.number) : '#' + c.id) + (c.contractor_name ? ' · ' + c.contractor_name : '')) + '</option>').join('') +
      '</select>';
    content.insertBefore(box, content.firstChild);
    const foot = document.querySelector('#supply-modal .owz2-foot');
    if (foot && !document.getElementById('owz-dest-hint')) {
      const hint = document.createElement('div');
      hint.id = 'owz-dest-hint'; hint.className = 'sc-err'; hint.style.display = 'none';
      foot.parentNode.insertBefore(hint, foot);
    }
    root._owzRenderCart();
  });
  function scOwzPaint() {
    const o = owz();
    const miss = root.scMissingDest(o.list || []);
    const hint = document.getElementById('owz-dest-hint');
    const sendBtn = document.querySelector('#supply-modal .owz2-foot .btn-primary');
    let msg = '';
    if (root.scHidePurchaseKind() && !o.kind) o.kind = root.SC_PAYMENT_DEFAULT_KIND;
    if (!o.kind) msg = 'Выберите тип закупки: товар, изготовление или услуга';
    else if (o.kind !== 'service' && miss) msg = miss + ' ' + (miss === 1 ? 'позиция' : 'позиций') + ' без назначения: заказ не отправится';
    if (hint) { hint.style.display = msg ? '' : 'none'; hint.innerHTML = msg ? '<i class="ti ti-alert-triangle"></i> ' + esc(msg) : ''; }
    if (sendBtn) { sendBtn.disabled = !!msg; sendBtn.title = msg || ''; }
    return !msg;
  }
  root.scOwzPaint = scOwzPaint;
  root.scOwzToggle = function (id, on) {
    const o = owz(); o.sel = o.sel || new Set();
    if (on) o.sel.add(String(id)); else o.sel.delete(String(id));
  };
  root.scOwzBulk = function (dest, onlySelected) {
    const o = owz();
    if (dest === 'contract' && !o.contractId) { root.showToast('Сначала выберите договор в «Куда»', 'error'); return; }
    const ids = onlySelected ? Array.from(o.sel || []) : null;
    if (onlySelected && !ids.length) { root.showToast('Отметьте строки галочками', 'info'); return; }
    root.scApplyBulk(o.list || [], ids, dest, o.contractId, o.contractNumber);
    root._owzRenderCart();
  };
  root.scOwzCycleDest = function (id) {
    const o = owz();
    const x = (o.list || []).find(v => String(v.id) === String(id));
    if (!x) return;
    const order = ['contract', 'stock', 'shop'];
    let i = order.indexOf(x.dest_type);
    for (let k = 0; k < 3; k++) {
      i = (i + 1) % 3;
      if (order[i] !== 'contract' || o.contractId) break;
    }
    root.scApplyBulk([x], null, order[i], o.contractId, o.contractNumber);
    root._owzRenderCart();
  };
  wrap('_owzRenderCart', function () {
    const box = document.getElementById('owz-cart');
    const o = owz();
    if (!box || !(o.list || []).length || !document.getElementById('owz-kind')) { scOwzPaint(); return; }
    o.sel = o.sel || new Set();
    const rows = box.querySelectorAll('.owz2-crow');
    (o.list || []).forEach((x, i) => {
      const row = rows[i];
      if (!row || row.querySelector('.sc-owz-dest')) return;
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.className = 'sc-owz-cb'; cb.checked = o.sel.has(String(x.id));
      cb.onchange = () => root.scOwzToggle(x.id, cb.checked);
      row.insertBefore(cb, row.firstChild);
      const chip = document.createElement('span');
      chip.className = 'sc-owz-dest';
      chip.innerHTML = root.scDestChipHtml(x.dest_type, x.dest_contract_number, 'scOwzCycleDest(' + JSON.stringify(x.id) + ')');
      row.appendChild(chip);
    });
    if (!document.getElementById('owz-bulk')) {
      const bar = document.createElement('div');
      bar.id = 'owz-bulk'; bar.className = 'sc-bulk';
      bar.innerHTML =
        '<button type="button" class="btn btn-secondary btn-small" onclick="scOwzBulk(\'contract\', false)"><i class="ti ti-checks"></i> Всё → к договору</button>' +
        '<button type="button" class="btn btn-secondary btn-small" onclick="scOwzBulk(\'stock\', false)"><i class="ti ti-building-warehouse"></i> Всё → на склад</button>' +
        '<button type="button" class="btn btn-secondary btn-small" onclick="scOwzBulk(\'contract\', true)"><i class="ti ti-file-text"></i> Выбранные → договор</button>' +
        '<button type="button" class="btn btn-secondary btn-small" onclick="scOwzBulk(\'stock\', true)">→ на склад</button>' +
        '<button type="button" class="btn btn-secondary btn-small" onclick="scOwzBulk(\'shop\', true)">→ в цех</button>';
      box.parentNode.insertBefore(bar, box);
    }
    scOwzPaint();
  });
  // Отправка: тип, «Куда», назначение строк уходят в POST /api/supply-orders
  const _origSubmit = root.submitOrderWizard;
  if (typeof _origSubmit === 'function') {
    root.submitOrderWizard = async function (send) {
      const o = owz();
      if (document.getElementById('owz-kind')) {
        if (root.scHidePurchaseKind() && !o.kind) o.kind = root.SC_PAYMENT_DEFAULT_KIND;
        if (!o.kind) { root.showToast('Выберите тип закупки', 'error'); return; }
        if (send && o.kind !== 'service' && root.scMissingDest(o.list || [])) { scOwzPaint(); root.showToast('Не у всех позиций выбрано назначение', 'error'); return; }
      }
      const origFetch = root.fetch;
      root.fetch = function (url, opts) {
        try {
          if (String(url).endsWith('/api/supply-orders') && opts && opts.method === 'POST' && opts.body) {
            const body = JSON.parse(opts.body);
            body.kind = o.kind || undefined;
            body.dest_type = o.dest || undefined;
            body.contract_id = o.dest === 'contract' ? (o.contractId || undefined) : undefined;
            const src = (o.list || []).filter(x => x.qty > 0);
            (body.items || []).forEach((it, i) => {
              const x = src[i];
              if (x && x.dest_type) { it.dest_type = x.dest_type; it.dest_contract_id = x.dest_contract_id || undefined; }
            });
            opts = Object.assign({}, opts, { body: JSON.stringify(body) });
          }
        } catch (e) { /* тело оставляем как есть */ }
        return origFetch.call(this, url, opts);
      };
      try { return await _origSubmit.apply(this, arguments); }
      finally { root.fetch = origFetch; }
    };
  }

  // ---------- превью письма: куда пойдут позиции
  wrap('_renderOrderPreviewModal', function (draft) {
    const items = (draft && draft.items) || [];
    if (!items.length) return;
    const modal = document.querySelector('.modal-overlay.visible .modal:last-child') || document.querySelector('.modal-overlay.visible .modal');
    if (!modal || modal.querySelector('.sc-preview-dest')) return;
    const cnt = {};
    items.forEach(it => {
      const k = it.dest_type === 'contract' ? ('№' + String(it.dest_contract_number || '?').replace(/^№\s*/, '')) : (it.dest_type === 'stock' ? 'Склад' : (it.dest_type === 'shop' ? 'Цех' : 'Не выбрано'));
      cnt[k] = (cnt[k] || 0) + 1;
    });
    const bad = cnt['Не выбрано'] || 0;
    const div = document.createElement('div');
    div.className = 'sc-preview-dest' + (bad ? ' bad' : '');
    div.innerHTML = '<i class="ti ti-map-pin"></i> Куда: ' + Object.keys(cnt).map(k => esc(k) + ' — ' + cnt[k] + ' поз.').join(' · ') +
      (bad && draft.id ? ' <button class="btn btn-secondary btn-small" onclick="scOpenDestPicker(' + Number(draft.id) + ', null, function(){showToast(\'Назначено\',\'success\')})">Назначить</button>' : '');
    const body = modal.querySelector('.modal-body, .modal-content') || modal;
    body.insertBefore(div, body.firstChild);
  });

  // ---------- «Загрузить счёт»: Тип, Куда, «Что в счёте?», сумма обязательна
  root._scInvLines = [];
  root.openUploadInvoiceToPay = async function () {
    const existing = document.getElementById('pay-inv-modal');
    if (existing) existing.remove();
    try { _payInvoiceFile = null; } catch (e) {}
    root._scInvLines = [];
    const list = await root.scContracts();
    const sups = (G('cache') && G('cache').suppliers) || [];
    const ov = document.createElement('div');
    ov.id = 'pay-inv-modal'; ov.className = 'modal-overlay visible';
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    ov.innerHTML =
      '<div class="modal" style="max-width:520px;" onclick="event.stopPropagation()">' +
        '<div class="modal-header"><h3><i class="ti ti-cloud-upload"></i> Счёт на оплату</h3>' +
          '<button class="icon-btn" onclick="document.getElementById(\'pay-inv-modal\').remove()"><i class="ti ti-x"></i></button></div>' +
        '<div class="modal-body">' +
          '<div id="pay-inv-drop" onclick="document.getElementById(\'pay-inv-file\').click()" class="sc-drop">' +
            '<i class="ti ti-file-upload"></i><div id="pay-inv-fname">Выбрать файл счёта (PDF, фото, Excel)</div></div>' +
          '<input type="file" id="pay-inv-file" accept="image/*,application/pdf,.pdf,.xlsx,.xls,.doc,.docx" style="display:none;" onchange="_payInvOnFile(event)">' +
          (root.scHidePurchaseKind() ? '' : '<div class="sc-lbl">Тип · обязательно</div>') +
          root.scKindSegHtml('payinv', null) +
          '<div class="sc-lbl">Куда · обязательно</div>' + root.scDestSegHtml('payinv-dest', null) +
          '<select id="pay-inv-contract" class="sc-select" style="margin-top:8px;display:none;">' + root.scContractOptionsHtml(list, null) + '</select>' +
          '<div class="sc-lbl">Поставщик по счёту</div>' +
          '<input type="text" id="pay-inv-supplier" list="pay-inv-sup-list" placeholder="Название продавца из счёта" class="sc-select">' +
          '<datalist id="pay-inv-sup-list">' + sups.filter(s => s.is_active !== 0).map(s => '<option value="' + esc(s.name) + '">').join('') + '</datalist>' +
          '<div class="sc-row2"><div><div class="sc-lbl">ИНН продавца</div><input type="text" id="pay-inv-inn" inputmode="numeric" class="sc-select" placeholder="10 или 12 цифр"></div>' +
            '<div><div class="sc-lbl">Номер счёта</div><input type="text" id="pay-inv-number" class="sc-select"></div></div>' +
          '<div class="sc-lbl">Сумма, ₽ · обязательно</div><input type="text" inputmode="decimal" id="pay-inv-amount" class="sc-select" placeholder="0,00">' +
          '<div id="pay-inv-lines-wrap"><div class="sc-lbl">Что в счёте? <span class="sc-hint">хотя бы одна позиция для товара и изготовления</span></div>' +
            '<div id="pay-inv-lines"></div>' +
            '<button type="button" class="btn btn-secondary btn-small" onclick="scInvAddLine()"><i class="ti ti-plus"></i> Добавить позицию</button></div>' +
          '<div id="pay-inv-status" class="sc-err" style="display:none;"></div>' +
          '<button class="btn btn-primary" id="pay-inv-send" style="width:100%;margin-top:14px;justify-content:center;" onclick="_payInvSubmit()"><i class="ti ti-send"></i> Отправить в оплату</button>' +
        '</div></div>';
    document.body.appendChild(ov);
    scInvPaint();
  };
  root._scOnSeg_payinv_kind = function () { scInvPaint(); };
  root._scOnSeg_payinv_dest = function (v) {
    const sel = document.getElementById('pay-inv-contract');
    if (sel) sel.style.display = v === 'contract' ? '' : 'none';
    root._scInvLines.forEach(l => { if (!l.dest_type) l.dest_type = v; });
    scInvPaint();
  };
  root.scInvAddLine = function () { root._scInvLines.push({ id: Date.now() + Math.random(), name: '', qty: 1, price: '', dest_type: root.scSegValue('payinv-dest') }); scInvPaint(); };
  root.scInvSet = function (i, k, v) { const l = root._scInvLines[i]; if (l) { l[k] = v; if (k === 'dest_type') scInvPaint(); else scInvHint(); } };
  root.scInvDel = function (i) { root._scInvLines.splice(i, 1); scInvPaint(); };
  function scInvHint() {
    const kind = root.scSegValue('payinv-kind');
    const dest = root.scSegValue('payinv-dest');
    const amt = Number(String((document.getElementById('pay-inv-amount') || {}).value || '').replace(/[\s\u00a0]/g, '').replace(',', '.'));
    const lines = root._scInvLines.filter(l => String(l.name || '').trim());
    let msg = '';
    if (!kind) msg = 'Выберите тип закупки';
    else if (kind !== 'service' && !dest) msg = 'Выберите, куда: договор, склад или цех';
    else if (kind !== 'service' && !lines.length) msg = 'Что в счёте? Добавьте хотя бы одну позицию';
    else if (kind !== 'service' && lines.some(l => !l.dest_type)) msg = 'У позиции не выбрано назначение';
    else if (!(amt > 0) && !lines.some(l => Number(l.price) > 0)) msg = 'Укажите сумму счёта';
    const el = document.getElementById('pay-inv-status');
    const btn = document.getElementById('pay-inv-send');
    if (el) { el.style.display = msg ? '' : 'none'; el.innerHTML = msg ? '<i class="ti ti-alert-triangle"></i> ' + esc(msg) : ''; }
    if (btn) btn.disabled = !!msg;
    return msg;
  }
  function scInvPaint() {
    const box = document.getElementById('pay-inv-lines');
    const wrapEl = document.getElementById('pay-inv-lines-wrap');
    const kind = root.scSegValue('payinv-kind');
    if (wrapEl) wrapEl.style.display = kind === 'service' ? 'none' : '';
    if (box) {
      box.innerHTML = root._scInvLines.map((l, i) =>
        '<div class="sc-inv-line">' +
          '<input class="sc-select" placeholder="Позиция" value="' + esc(l.name) + '" oninput="scInvSet(' + i + ',\'name\',this.value)">' +
          '<input class="sc-select sc-num" inputmode="decimal" value="' + esc(l.qty) + '" oninput="scInvSet(' + i + ',\'qty\',this.value)" title="Кол-во">' +
          '<input class="sc-select sc-num" inputmode="decimal" placeholder="цена" value="' + esc(l.price) + '" oninput="scInvSet(' + i + ',\'price\',this.value)">' +
          '<select class="sc-select sc-dest-sel" onchange="scInvSet(' + i + ',\'dest_type\',this.value)">' +
            '<option value="">Куда?</option>' + root.SC_DESTS.map(d => '<option value="' + d[0] + '"' + (l.dest_type === d[0] ? ' selected' : '') + '>' + d[1] + '</option>').join('') +
          '</select>' +
          '<button type="button" class="icon-btn" onclick="scInvDel(' + i + ')"><i class="ti ti-x"></i></button>' +
        '</div>').join('');
    }
    const amt = document.getElementById('pay-inv-amount');
    if (amt && !amt._sc) { amt._sc = 1; amt.addEventListener('input', scInvHint); }
    scInvHint();
  }
  root.scInvHint = scInvHint;
  root._payInvSubmit = async function () {
    const file = G('_payInvoiceFile');
    if (!file) { root.showToast('Сначала выберите файл счёта', 'error'); return; }
    if (scInvHint()) return;
    const statusEl = document.getElementById('pay-inv-status');
    const fd = new FormData();
    fd.append('file', file, file.name);
    const kind = root.scSegValue('payinv-kind');
    const dest = root.scSegValue('payinv-dest');
    fd.append('kind', kind);
    if (dest) fd.append('dest_type', dest);
    const c = document.getElementById('pay-inv-contract');
    if (dest === 'contract' && c && c.value) fd.append('contract_id', c.value);
    const v = id => ((document.getElementById(id) || {}).value || '').trim();
    if (v('pay-inv-supplier')) fd.append('supplier_name', v('pay-inv-supplier'));
    if (v('pay-inv-inn')) fd.append('seller_inn', v('pay-inv-inn'));
    if (v('pay-inv-number')) fd.append('invoice_number', v('pay-inv-number'));
    if (v('pay-inv-amount')) fd.append('amount', v('pay-inv-amount'));
    const cid = dest === 'contract' && c ? Number(c.value) || null : null;
    fd.append('items', JSON.stringify(root._scInvLines.filter(l => String(l.name || '').trim()).map(l => ({
      name: l.name, qty: l.qty, price: l.price, dest_type: l.dest_type || dest,
      dest_contract_id: (l.dest_type || dest) === 'contract' ? cid : null,
    }))));
    if (statusEl) { statusEl.style.display = ''; statusEl.innerHTML = '<i class="ti ti-loader"></i> Отправляем…'; }
    try {
      const res = await fetch(G('API_BASE') + '/api/supply-orders/from-invoice', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + localStorage.getItem(G('TOKEN_KEY')) }, body: fd,
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && d.order_id) {
        if (statusEl) statusEl.innerHTML = esc(d.message || 'Такой счёт уже есть') +
          ' <button class="btn btn-secondary btn-small" onclick="openSupplyOrder(' + Number(d.order_id) + ');document.getElementById(\'pay-inv-modal\').remove()">Открыть ' + esc(d.order_label || '') + '</button>';
        return;
      }
      if (!res.ok) { if (statusEl) statusEl.textContent = d.message || ('Ошибка ' + res.status); return; }
      root.showToast('Счёт отправлен в оплату ✓', 'success');
      const m = document.getElementById('pay-inv-modal'); if (m) m.remove();
      if (G('cache')) G('cache').supplyOrders = null;
      try { if (document.getElementById('pay-list-body')) root.loadPayList(); } catch (_) {}
      try { root._fillPayDueBlock(); } catch (_) {}
    } catch (e) {
      if (statusEl) statusEl.textContent = 'Сеть: ' + (e.message || e);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* ---------------------------------------------------------------------------
 * «Счета на оплату»: поиск по всем полям, фильтры-чипы, проблемные строки.
 * Глобальные let/const из app-3.js (_payListState, _payListItems …) — по имени.
 * ------------------------------------------------------------------------- */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  const esc = root._esc;
  let _scPayIssues = null;
  let _scPayTimer = null;
  const TYPE_LBL = { goods: 'Товар', mfg: 'Изгот.', service: 'Услуга' };
  const CH_LBL = { email: 'почта', max: 'MAX', telegram: 'Telegram', upload: 'загрузил', manual: 'вручную' };

  function st() { return typeof _payListState !== 'undefined' ? _payListState : {}; }

  root.onPayListSearch = function (value) {
    st().q = value || '';
    clearTimeout(_scPayTimer);
    _scPayTimer = setTimeout(root.loadPayList, 250);
  };
  root.scPaySet = function (key, value, debounce) {
    st()[key] = String(value || '').trim();
    clearTimeout(_scPayTimer);
    if (debounce) _scPayTimer = setTimeout(root.loadPayList, 250); else root.loadPayList();
  };
  root.scPayFlag = function (flag) {
    const s = st(); s[flag] = !s[flag];
    document.querySelectorAll('#sc-pay-chips .sc-fchip').forEach(b => b.classList.toggle('on', !!st()[b.getAttribute('data-flag')]));
    root.loadPayList();
  };
  async function fillContracts() {
    const sel = document.getElementById('sc-pay-contract');
    if (!sel || sel.dataset.ready === '1') return;
    const list = await root.scContracts();
    if (!list.length) return;
    sel.innerHTML = '<option value="">Договор: все</option>' + list.map(c =>
      '<option value="' + Number(c.id) + '">' + esc((c.number ? (String(c.number).trim().startsWith('№') ? c.number : '№ ' + c.number) : '#' + c.id) + (c.contractor_name ? ' · ' + c.contractor_name : '')) + '</option>').join('');
    sel.value = st().contract_id || '';
    sel.dataset.ready = '1';
  }

  root.loadPayList = async function () {
    const box = document.getElementById('pay-list-body');
    if (!box) return;
    const btn = document.getElementById('pay-list-advance-btn');
    if (btn) btn.style.display = root.canCreateSupplierAdvance() ? '' : 'none';
    const suppliers = await root._payListSupplierOptions();
    root._fillPayListSupplierSelect(suppliers);
    fillContracts();
    const s = st();
    const p = new URLSearchParams();
    p.set('tab', s.tab || 'to_pay');
    if ((s.q || '').trim()) p.set('q', s.q.trim());
    if (s.supplier_id) p.set('supplier_id', s.supplier_id);
    if (s.only_advances) p.set('only_advances', '1');
    else if (s.type) p.set('type', s.type);
    if (s.mine) p.set('mine', '1');
    ['contract_id', 'date_from', 'date_to', 'amount_from', 'amount_to', 'payer'].forEach(k => { if (s[k]) p.set(k, s[k]); });
    ['no_supplier', 'zero_amount', 'duplicates'].forEach(k => { if (s[k]) p.set(k, '1'); });
    const reqQ = p.toString();
    root._scPayLastQ = reqQ;
    try {
      const d = await root.apiGet('/api/pay-list?' + reqQ);
      if (root._scPayLastQ !== reqQ) return; // пришёл ответ на старый запрос
      _payListItems = d.items || [];
      _payListCanCreate = !!d.can_create_advance;
      root.syncAdvanceCreateButton();
      const counts = d.counts || {};
      document.querySelectorAll('[data-pay-count]').forEach(el => {
        const key = el.getAttribute('data-pay-count');
        el.textContent = counts[key] != null ? counts[key] : 0;
      });
      _scPayIssues = d.issues || null;
      root.renderPayList();
    } catch (e) {
      box.innerHTML = '<div class="pay-list-empty">Не удалось загрузить список</div>';
    }
  };

  // «Поставщик не указан» — только когда у счёта действительно нет поставщика.
  root._payListSupplierLabel = function (row) {
    if (!row) return '';
    if (row.kind === 'invoice' && (!row.supplier_id || row.needs_supplier)) return '';
    return String(row.supplier_name || '').trim();
  };

  function supplierCell(row) {
    const seller = String(row.invoice_seller_name || '').trim();
    const label = root._payListSupplierLabel(row);
    const inn = row.invoice_seller_inn || row.supplier_inn || '';
    let h;
    if (row.supplier_is_person) {
      h = (seller ? esc(seller) + ' <span class="sc-chip sc-chip-bad">не в справочнике</span>' : '<span class="pay-list-nosup">Поставщик не указан</span>') +
        '<div class="sc-sub sc-bad">записан: ' + esc(label || '—') + '</div>';
      if (inn) h += '<div class="sc-sub">ИНН ' + esc(inn) + '</div>';
      return h;
    }
    h = label ? esc(label) : (seller ? esc(seller) + ' <span class="sc-chip sc-chip-bad">не в справочнике</span>' : '<span class="pay-list-nosup">Поставщик не указан</span>');
    if (label && seller && root.scNorm(seller) !== root.scNorm(label)) h += '<div class="sc-sub">по счёту: ' + esc(seller) + '</div>';
    if (inn) h += '<div class="sc-sub">ИНН ' + esc(inn) + '</div>';
    return h;
  }
  function purposeCell(row) {
    let h = esc(row.purpose || '—');
    if (row.kind === 'invoice') {
      const chip = row.dest_type === 'contract' || row.contract_number
        ? '<span class="sc-chip sc-chip-contract">№' + esc(String(row.contract_number || '?').replace(/^№\s*/, '')) + (row.contractor_name ? ' · ' + esc(row.contractor_name) : '') + '</span>'
        : (row.dest_type === 'stock' ? '<span class="sc-chip">Склад</span>' : (row.dest_type === 'shop' ? '<span class="sc-chip">Цех</span>' : ''));
      if (chip) h += '<div>' + chip + '</div>';
    }
    return h;
  }
  function whoCell(row) {
    const sender = String(row.sender_name || '').trim();
    const author = String(row.author_name || '').trim();
    if (sender && author && sender !== author) return esc(sender) + '<div class="sc-sub">' + esc(CH_LBL[row.sender_channel] || row.sender_channel || '') + ' · внёс ' + esc(author) + '</div>';
    if (sender) return esc(sender) + (row.sender_channel ? '<div class="sc-sub">' + esc(CH_LBL[row.sender_channel] || row.sender_channel) + '</div>' : '');
    return esc(author || '—');
  }
  function statusCell(row) {
    const paid = row.status === 'paid';
    const ch = row.order_status && root.SC_STATUS[row.order_status];
    return '<span class="pay-list-status"><span class="pay-list-dot ' + (paid ? 'paid' : 'to_pay') + '"></span>' +
      esc(ch && row.kind === 'invoice' ? ch : (paid ? 'Оплачен' : 'На оплату')) + '</span>';
  }
  function issueActions(row) {
    const id = Number(row.id);
    const out = [];
    (row.issues || []).forEach(k => {
      if (k === 'no_supplier') {
        if (row.invoice_seller_name || row.invoice_seller_inn) out.push('<button class="btn btn-secondary btn-small" onclick="event.stopPropagation();scPayFix(\'seller\',' + id + ',this)"><i class="ti ti-file-import"></i> Взять из счёта</button>');
        out.push('<button class="btn btn-secondary btn-small" onclick="event.stopPropagation();scPayPickSupplier(' + id + ')"><i class="ti ti-building-store"></i> Выбрать</button>');
      }
      if (k === 'zero_amount') out.push('<button class="btn btn-secondary btn-small" onclick="event.stopPropagation();scPayFix(\'amount\',' + id + ',this)"><i class="ti ti-scan"></i> Распознать сумму</button>');
      if (k === 'duplicate' && row.duplicate_of) out.push('<button class="btn btn-secondary btn-small" onclick="event.stopPropagation();scPayFix(\'merge\',' + id + ',this,' + Number(row.duplicate_of.order_id) + ')"><i class="ti ti-git-merge"></i> Слить с ' + esc(row.duplicate_of.order_label) + '</button>');
    });
    return out.join(' ');
  }

  function issuesBanner(list) {
    const box = document.getElementById('sc-pay-issues');
    if (!box) return;
    const is = _scPayIssues || {};
    const bad = list.filter(r => (r.issues || []).length);
    if (!is.total && !bad.length) { box.innerHTML = ''; return; }
    const chip = (flag, key, lbl) => is[key] ? '<button class="sc-fchip bad' + (st()[flag] ? ' on' : '') + '" onclick="scPayFlag(\'' + flag + '\')">' + lbl + ' · ' + is[key] + '</button>' : '';
    let h = '<div class="sc-issues"><div class="sc-issues-head"><i class="ti ti-alert-triangle"></i> Требуют исправления: <b>' + Number(is.total || bad.length) + '</b>' +
      chip('no_supplier', 'no_supplier', 'нет поставщика') + chip('zero_amount', 'zero_amount', 'сумма 0') + chip('duplicates', 'duplicate', 'дубли') + '</div>';
    if (bad.length) {
      h += '<table class="sc-issues-table"><tbody>' + bad.slice(0, 12).map(r =>
        '<tr><td><a href="#" onclick="event.preventDefault();openPayListRow(\'invoice\',' + Number(r.id) + ')">' + esc(r.order_label || ('ORD-' + r.id)) + '</a></td>' +
        '<td>' + esc(r.invoice_seller_name || root._payListSupplierLabel(r) || '—') + '</td>' +
        '<td class="sc-num">' + root._payListMoney(r.amount) + '</td>' +
        '<td>' + (r.issue_labels || []).map(x => '<span class="sc-chip sc-chip-bad">' + esc(x) + '</span>').join(' ') + '</td>' +
        '<td class="sc-acts">' + issueActions(r) + '</td></tr>').join('') + '</tbody></table>' +
        (bad.length > 12 ? '<div class="sc-sub">ещё ' + (bad.length - 12) + ' — включите фильтр выше</div>' : '');
    }
    box.innerHTML = h + '</div>';
  }

  root.renderPayList = function () {
    const box = document.getElementById('pay-list-body');
    if (!box) return;
    const list = (typeof _payListItems !== 'undefined' && _payListItems) || [];
    issuesBanner(list);
    if (!list.length) {
      box.innerHTML = '<div class="pay-list-empty">' + (st().q ? 'Ничего не нашлось по «' + esc(st().q) + '»' : 'В этом списке пока пусто') + '</div>';
      return;
    }
    const canPay = root.canMarkPayListPaid();
    let html = '<table class="pay-list-table sc-pay-table" translate="no"><thead><tr>' +
      '<th>Дата</th><th>Тип</th><th>Поставщик (по счёту)</th><th>Назначение</th><th>№ счёта</th>' +
      '<th>Сумма</th><th>Прислал / Внёс</th><th>Статус</th><th></th></tr></thead><tbody>';
    let cards = '<div class="pay-list-cards" translate="no">';
    list.forEach(row => {
      const advance = row.kind === 'advance';
      const tag = advance ? '<span class="pay-list-tag advance">Аванс</span>'
        : '<span class="pay-list-tag invoice">' + esc(TYPE_LBL[row.type] || 'Счёт') + '</span>';
      const orderText = advance ? 'без заказа' : (row.order_label || ('ORD-' + row.order_id));
      const paid = row.status === 'paid';
      const payBtn = (!paid && canPay)
        ? '<button class="btn btn-primary btn-small" style="margin-right:6px;" onclick="event.stopPropagation();payListMarkPaid(\'' + row.kind + '\',' + row.id + ', this)">Оплатил</button>' : '';
      const open = 'openPayListRow(\'' + row.kind + '\',' + row.id + ')';
      const bad = (row.issues || []).length;
      const matched = (row.matched || []).length
        ? '<tr class="sc-matched-row"><td></td><td colspan="8"><span class="sc-matched">совпало: ' + row.matched.map(esc).join(' · ') + '</span></td></tr>' : '';
      html += '<tr class="' + (bad ? 'sc-row-bad' : '') + '">' +
        '<td>' + esc(root._payListDate(row.date)) + '</td>' +
        '<td>' + tag + '</td>' +
        '<td>' + supplierCell(row) + '<span class="pay-list-order">' + esc(orderText) + '</span></td>' +
        '<td>' + purposeCell(row) + '</td>' +
        '<td>' + esc(row.invoice_number || '—') + '</td>' +
        '<td class="sc-num" style="white-space:nowrap;font-weight:700;">' + (Number(row.amount) ? root._payListMoney(row.amount) : '<span class="sc-chip sc-chip-bad">0 ₽</span>') + '</td>' +
        '<td>' + whoCell(row) + '</td>' +
        '<td>' + statusCell(row) + (row.duplicate_of ? '<div class="sc-sub sc-bad">дубль ' + esc(row.duplicate_of.order_label) + '</div>' : '') + '</td>' +
        '<td style="white-space:nowrap;">' + payBtn + '<button class="btn btn-secondary btn-small" onclick="' + open + '">Открыть</button></td>' +
      '</tr>' + matched;
      cards += '<div class="pay-card' + (bad ? ' sc-row-bad' : '') + '" role="button" tabindex="0" onclick="' + open + '">' +
        '<div class="pay-card-top"><span class="pay-card-sup">' + supplierCell(row) + '</span>' +
          '<span class="pay-card-sum">' + root._payListMoney(row.amount) + '</span></div>' +
        '<div class="pay-card-purpose">' + purposeCell(row) + '</div>' +
        '<div class="pay-card-meta"><span>' + esc(root._payListDate(row.date)) + '</span>' + tag +
          '<span class="pay-card-ord">' + esc(orderText) + (row.invoice_number ? ' · № ' + esc(row.invoice_number) : '') + '</span>' + statusCell(row) + '</div>' +
        '<div class="pay-card-author">' + whoCell(row) + '</div>' +
        ((row.matched || []).length ? '<div class="sc-matched">совпало: ' + row.matched.map(esc).join(' · ') + '</div>' : '') +
        (payBtn || bad ? '<div class="pay-card-actions">' + payBtn + issueActions(row) + '</div>' : '') +
      '</div>';
    });
    box.innerHTML = html + '</tbody></table>' + cards + '</div>';
  };

  root.scNorm = function (s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim(); };

  async function scPost(path, body) {
    const r = await root.apiPost(path, body || {});
    if (!r || !r.ok) throw new Error((r && r.data && (r.data.message || r.data.error)) || ('Ошибка ' + (r && r.status)));
    return r.data || {};
  }
  root.scPost = scPost;
  function scPlanText(plan) {
    if (!plan || typeof plan !== 'object') return '';
    const parts = [];
    const f = Object.keys(plan.fill || {});
    if (f.length) parts.push('поля: ' + f.join(', '));
    if (plan.move_items) parts.push('позиций: ' + plan.move_items);
    return parts.join('; ') || 'ничего — в целевом заказе уже всё заполнено';
  }
  root.scPayFix = async function (what, id, btn, target) {
    if (btn) btn.disabled = true;
    try {
      if (what === 'seller') {
        const r = await scPost('/api/supply-orders/' + id + '/supplier', { from_invoice: true });
        root.showToast(r && r.created ? 'Поставщик заведён по реквизитам счёта' : 'Поставщик найден по реквизитам счёта', 'success');
      } else if (what === 'amount') {
        const r = await scPost('/api/supply-orders/' + id + '/invoice/rerecognize', {});
        const total = r && r.changes && r.changes.invoice_total;
        if (!total) { root.showToast('Сумму распознать не удалось — откройте счёт и введите вручную', 'error'); return; }
        if (!confirm('Сумма по счёту: ' + Number(total).toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + ' ₽' + (r.source ? ' (' + r.source + ')' : '') + '. Записать?')) return;
        await scPost('/api/supply-orders/' + id + '/invoice/rerecognize', { apply: true });
        root.showToast('Сумма записана', 'success');
      } else if (what === 'merge') {
        const pre = await scPost('/api/supply-orders/' + id + '/merge-into/' + target, { dry_run: true });
        if (!confirm('Слить ORD-' + id + ' в ORD-' + target + '?' + (pre && pre.plan ? '\nПеренесём: ' + scPlanText(pre.plan) : '') + '\nORD-' + id + ' будет отменён с причиной «дубль».')) return;
        await scPost('/api/supply-orders/' + id + '/merge-into/' + target, {});
        root.showToast('Слито с ORD-' + target, 'success');
      }
      root.loadPayList();
    } catch (e) {
      root.showToast((e && e.message) || 'Не получилось', 'error');
    } finally { if (btn) btn.disabled = false; }
  };
  root.scPayPickSupplier = async function (id) {
    const sups = await root._payListSupplierOptions();
    const old = document.getElementById('sc-sup-pick'); if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = 'sc-sup-pick'; ov.className = 'modal-overlay visible';
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    ov.innerHTML = '<div class="modal" style="max-width:420px;" onclick="event.stopPropagation()"><div class="modal-header"><h3>Поставщик по счёту</h3>' +
      '<button class="icon-btn" onclick="document.getElementById(\'sc-sup-pick\').remove()"><i class="ti ti-x"></i></button></div><div class="modal-body">' +
      '<select id="sc-sup-pick-sel" class="sc-select">' + sups.map(s => '<option value="' + Number(s.id) + '">' + esc(s.name) + (s.inn ? ' · ИНН ' + esc(s.inn) : '') + '</option>').join('') + '</select>' +
      '<div class="sc-sub" style="margin-top:6px;">Отправитель счёта запомнится как контакт этого поставщика.</div>' +
      '<button class="btn btn-primary" style="width:100%;margin-top:12px;justify-content:center;" id="sc-sup-pick-ok">Сохранить</button></div></div>';
    document.body.appendChild(ov);
    document.getElementById('sc-sup-pick-ok').onclick = async () => {
      const sid = Number(document.getElementById('sc-sup-pick-sel').value);
      try {
        await scPost('/api/supply-orders/' + id + '/supplier', { supplier_id: sid });
        ov.remove(); root.showToast('Поставщик сохранён', 'success');
        if (document.getElementById('pay-list-body')) root.loadPayList();
        if (typeof state !== 'undefined' && state.currentSupplyOrderId === id && root.openSupplyOrder) root.openSupplyOrder(id);
      } catch (e) { root.showToast((e && e.message) || 'Ошибка', 'error'); }
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* ---------------------------------------------------------------------------
 * Карточка заказа: тип, «Куда» по строкам, поставщик по счёту, отмена с
 * причиной, «Слить с ORD-…», перераспознать счёт. Карточка договора:
 * «Закупка по договору».
 * ------------------------------------------------------------------------- */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  const esc = root._esc;
  const post = (p, b) => root.scPost(p, b);
  const reload = () => { try { if (typeof cache !== 'undefined') cache.supplyOrders = null; } catch (_) {} root.loadSupplyOrderDetail(); };

  function orderChainHtml(o) {
    const items = o.items || [];
    const st = o.chain_status || o.status;
    const kind = o.kind || '';
    const kindChips = root.SC_KINDS.map(k => '<button type="button" class="sc-fchip' + (kind === k[0] ? ' on' : '') + '" onclick="scOrderKind(' + Number(o.id) + ',\'' + k[0] + '\')">' + esc(k[1]) + '</button>').join('');
    let h = '<div class="detail-block sc-order-chain">';
    h += '<div class="sc-oc-top">' + root.scStepperHtml(o.step && o.step.index, st) +
      (o.step && o.step.days != null ? '<div class="sc-sub">на этом шаге ' + Number(o.step.days) + ' дн</div>' : '') + '</div>';
    if (!root.scHidePurchaseKind()) {
      h += '<div class="sc-oc-row"><span class="sc-oc-l">Тип</span>' + kindChips + (!kind ? ' <span class="sc-chip sc-chip-bad">не выбран</span>' : '') + '</div>';
    }
    if (st === 'paid') {
      // v2.46.292: после оплаты — не всегда «едет»: «В изготовлении» / «Ждём отгрузку» / «Едет»
      const sub = o.paid_substage || '';
      const subChip = (v, label) => '<button type="button" class="sc-fchip' + (sub === v ? ' on' : '') + '" onclick="scOrderSubstage(' + Number(o.id) + ',\'' + v + '\')">' + esc(label) + '</button>';
      h += '<div class="sc-oc-row sc-oc-substage"><span class="sc-oc-l">Сейчас</span>' +
        subChip('manufacturing', 'В изготовлении') + subChip('', 'Ждём отгрузку') +
        '<button type="button" class="sc-fchip" onclick="scOrderSubstage(' + Number(o.id) + ',\'shipping\')">Едет</button>' +
        (o.invoice_delivery_term ? ' <span class="sc-sub">срок по счёту: ' + esc(o.invoice_delivery_term) + '</span>' : '') + '</div>';
    }
    if (o.needs_supplier) {
      h += '<div class="sc-alert"><i class="ti ti-alert-triangle"></i> Поставщик не определён' +
        (o.invoice_seller_name ? ' · по счёту: <b>' + esc(o.invoice_seller_name) + '</b>' + (o.invoice_seller_inn ? ' ИНН ' + esc(o.invoice_seller_inn) : '') : '') +
        (o.sender_name ? ' · прислал ' + esc(o.sender_name) : '') +
        '<span class="sc-acts">' +
        ((o.invoice_seller_name || o.invoice_seller_inn) ? '<button class="btn btn-secondary btn-small" onclick="scOrderSupplier(' + Number(o.id) + ', true)">Взять из счёта</button>' : '') +
        '<button class="btn btn-secondary btn-small" onclick="scPayPickSupplier(' + Number(o.id) + ')">Выбрать</button></span></div>';
    }
    {
      // v2.46.285: «Куда» в карточке — всегда редактируемое, и у заказа без строк
      const cur = "{type:" + JSON.stringify(o.dest_type || null).replace(/"/g, "'") + ",contract_id:" + (Number(o.contract_id) || 'null') + "}";
      const lbl = JSON.stringify([o.order_label || ('ORD-' + o.id)]).replace(/"/g, "'");
      const pick = 'scOpenDestPicker(' + Number(o.id) + ', null, loadSupplyOrderDetail, ' + cur + ', {labels:' + lbl + '})';
      const has = !!o.dest_type;
      const miss = items.length ? root.scMissingDest(items) : 0;
      h += '<div class="sc-oc-row sc-oc-dest"><span class="sc-oc-l">Куда</span>' +
        (items.length && !has && !miss ? '' : root.scDestChipHtml(o.dest_type || null, o.contract_number || '', pick)) +
        (items.length ? (miss ? (o.chain_new === false
          // заказ создан до v2.46.283: назначение не обязательно, не красим
          ? ' <span class="sc-chip" title="Заказ создан до v2.46.283 — назначение не обязательно">' + miss + ' без назначения · необязательно</span>'
          : ' <span class="sc-chip sc-chip-bad">' + miss + ' без назначения</span>') : ' <span class="sc-chip">все позиции назначены</span>') : '') +
        ' <button class="btn btn-' + (has || (items.length && !miss) ? 'secondary' : 'primary') + ' btn-small sc-dest-edit" onclick="' + pick + '"><i class="ti ti-map-pin"></i> ' +
        (has || (items.length && !miss) ? 'Изменить «Куда»' : 'Назначить «Куда»') + '</button>' +
        (kind === 'service' ? ' <span class="sc-sub">для услуги необязательно</span>' : '') + '</div>';
      if (items.length) {
        h += '<div class="sc-oc-items">' + items.map(it =>
          '<div class="sc-oc-item"><span class="sc-oc-name">' + esc(it.item_name || it.component_name || it.name || ('#' + it.id)) + '</span>' +
          '<span class="sc-sub">' + esc(String(it.qty != null ? it.qty : '')) + ' ' + esc(it.unit || '') + '</span>' +
          root.scDestChipHtml(it.dest_type, it.dest_contract_number, 'scOpenDestPicker(' + Number(o.id) + ',[' + Number(it.id) + '],loadSupplyOrderDetail)') + '</div>').join('') + '</div>';
      }
    }
    if (o.cancel_reason) h += '<div class="sc-sub">Причина отмены: ' + esc(o.cancel_reason) + '</div>';
    if (o.merged_into_order_id) h += '<div class="sc-sub">Слит в <a href="#" onclick="event.preventDefault();openSupplyOrder(' + Number(o.merged_into_order_id) + ')">ORD-' + Number(o.merged_into_order_id) + '</a></div>';
    const acts = [];
    if (o.invoice_file_key || o.invoice_filename) acts.push('<button class="btn btn-secondary btn-small" onclick="scOrderRerecognize(' + Number(o.id) + ')"><i class="ti ti-scan"></i> Перераспознать счёт</button>');
    const dup = typeof supOrdDup === 'function' ? supOrdDup(o) : null;
    if (dup && dup.orderId && !['cancelled', 'closed'].includes(o.status)) acts.push('<button class="btn btn-secondary btn-small" onclick="scPayFix(\'merge\',' + Number(o.id) + ',this,' + Number(dup.orderId) + ')"><i class="ti ti-git-merge"></i> Слить с ORD-' + Number(dup.orderId) + '</button>');
    if (acts.length) h += '<div class="sc-oc-row">' + acts.join(' ') + '</div>';
    return h + '</div>';
  }
  root.scOrderChainHtml = orderChainHtml;

  const _origDetail = root.renderSupplyOrderDetail;
  if (typeof _origDetail === 'function') {
    root.renderSupplyOrderDetail = function (o) {
      const r = _origDetail.apply(this, arguments);
      try {
        const c = document.getElementById('sup-ord-detail');
        const head = c && c.querySelector('.page-header');
        if (head && o && !c.querySelector('.sc-order-chain')) {
          const div = document.createElement('div');
          div.innerHTML = orderChainHtml(o);
          const anchor = c.querySelector('.dup-alert') || head;
          anchor.parentNode.insertBefore(div.firstChild, anchor.nextSibling);
        }
        if (o && o.id && o.kind !== 'service') root.scLoadInvLines(o.id);
      } catch (e) { console.warn('sc order card', e); }
      return r;
    };
  }

  root.scLoadInvLines = async function (id) {
    try {
      const d = await root.apiGet('/api/supply-orders/' + Number(id) + '/invoice-lines');
      const html = root.scInvLinesHtml(id, (d && d.lines) || []);
      const box = document.querySelector('#sup-ord-detail .sc-order-chain');
      if (!box || !html || document.getElementById('sc-invlines-' + Number(id))) return;
      const div = document.createElement('div'); div.innerHTML = html;
      box.appendChild(div.firstChild);
    } catch (e) { /* предложение необязательно */ }
  };
  root.scInvLinesAccept = async function (id) {
    const rows = Array.from(document.querySelectorAll('#sc-invlines-' + Number(id) + ' .sc-invline'));
    const lines = rows.filter(r => r.querySelector('input').checked).map(r => {
      const item = Number(r.getAttribute('data-item')) || null;
      return item ? { idx: Number(r.getAttribute('data-idx')), item_id: item }
                  : { idx: Number(r.getAttribute('data-idx')), create: true };
    });
    if (!lines.length) { root.showToast('Ничего не выбрано', 'error'); return; }
    const nNew = lines.filter(l => l.create).length;
    if (nNew && !confirm('Завести в номенклатуру новых позиций: ' + nNew + '?')) return;
    try {
      const r = await post('/api/supply-orders/' + Number(id) + '/invoice-lines/accept', { lines });
      root.showToast('Добавлено строк: ' + r.added + (r.created_items ? ', новых позиций: ' + r.created_items : ''), 'success');
      reload();
    } catch (e) { root.showToast(e.message, 'error'); }
  };

  root.scOrderSubstage = async function (id, sub) {
    if (sub === 'shipping') {
      if (typeof root.transitionSupplyOrder === 'function') return root.transitionSupplyOrder(id, 'shipping');
      return;
    }
    try {
      await post('/api/supply-orders/' + id + '/substage', { substage: sub || null });
      root.showToast(sub === 'manufacturing' ? 'В изготовлении' : 'Оплачен, ждём отгрузку', 'success');
      reload();
    } catch (e) { root.showToast(e.message, 'error'); }
  };
  root.scOrderKind = async function (id, kind) {
    try { await post('/api/supply-orders/' + id + '/kind', { kind }); root.showToast('Тип: ' + root.scKindLabel(kind), 'success'); reload(); }
    catch (e) { root.showToast(e.message, 'error'); }
  };
  root.scOrderSupplier = async function (id, fromInvoice) {
    try { await post('/api/supply-orders/' + id + '/supplier', { from_invoice: !!fromInvoice }); root.showToast('Поставщик сохранён', 'success'); reload(); }
    catch (e) { root.showToast(e.message, 'error'); }
  };
  root.scOrderRerecognize = async function (id) {
    let r;
    try { r = await post('/api/supply-orders/' + id + '/invoice/rerecognize', {}); }
    catch (e) { root.showToast(e.message, 'error'); return; }
    const ch = r.changes || {};
    const keys = Object.keys(ch);
    const L = { invoice_total: 'Сумма', invoice_number: '№ счёта', invoice_seller_inn: 'ИНН продавца', invoice_seller_name: 'Продавец' };
    const B = { invoice_total: 'total', invoice_number: 'number', invoice_seller_inn: 'inn', invoice_seller_name: 'seller' };
    const old = document.getElementById('sc-rr'); if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = 'sc-rr'; ov.className = 'modal-overlay visible';
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    ov.innerHTML = '<div class="modal" style="max-width:480px;" onclick="event.stopPropagation()"><div class="modal-header"><h3>Перераспознать счёт</h3>' +
      '<button class="icon-btn" onclick="document.getElementById(\'sc-rr\').remove()"><i class="ti ti-x"></i></button></div><div class="modal-body">' +
      (keys.length ? '<table class="sc-issues-table"><thead><tr><th></th><th>Было</th><th>Станет</th></tr></thead><tbody>' + keys.map(k =>
        '<tr><td>' + esc(L[k] || k) + '</td><td>' + esc(String((r.before || {})[B[k]] || '—')) + '</td><td><b>' + esc(String(ch[k])) + '</b></td></tr>').join('') + '</tbody></table>' +
        '<div class="sc-sub">Источник: ' + esc(r.source || '—') + '. Заполняются только пустые поля.</div>' +
        '<button class="btn btn-primary" style="width:100%;margin-top:12px;justify-content:center;" id="sc-rr-ok">Записать</button>'
        : '<div class="sc-sub">Нового ничего не нашлось — все поля уже заполнены или счёт не читается.</div>') +
      '</div></div>';
    document.body.appendChild(ov);
    const ok = document.getElementById('sc-rr-ok');
    if (ok) ok.onclick = async () => {
      try { await post('/api/supply-orders/' + id + '/invoice/rerecognize', { apply: true }); ov.remove(); root.showToast('Записано', 'success'); reload(); }
      catch (e) { root.showToast(e.message, 'error'); }
    };
  };

  // Отмена — только с причиной
  const _origTransition = root.transitionSupplyOrder;
  if (typeof _origTransition === 'function') {
    root.transitionSupplyOrder = async function (orderId, newStatus, confirmText) {
      if (newStatus !== 'cancelled') return _origTransition.apply(this, arguments);
      const reason = (prompt('Причина отмены (обязательно):', '') || '').trim();
      if (!reason) { root.showToast('Без причины заказ не отменить', 'info'); return; }
      try { await post('/api/supply-orders/' + orderId + '/cancel', { reason }); root.showToast('Заказ отменён', 'success'); reload(); }
      catch (e) { root.showToast(e.message, 'error'); }
    };
  }

  // Карточка договора → «Закупка по договору»
  const _origContract = root.renderContractDetail;
  if (typeof _origContract === 'function') {
    root.renderContractDetail = function (c) {
      const r = _origContract.apply(this, arguments);
      if (c && c.id) setTimeout(() => scContractSupply(c.id), 0);
      return r;
    };
  }
  async function scContractSupply(cid) {
    const host = document.getElementById('scd-content');
    if (!host) return;
    let d;
    try { d = await root.apiGet('/api/contracts/' + Number(cid) + '/supply-lines'); } catch (e) { return; }
    const items = (d && d.items) || [];
    let box = document.getElementById('sc-contract-supply');
    if (!box) { box = document.createElement('div'); box.id = 'sc-contract-supply'; box.className = 'detail-block sc-contract-supply'; host.appendChild(box); }
    if (!items.length) { box.innerHTML = '<div class="detail-block-title"><i class="ti ti-truck"></i> Закупка по договору</div><div class="sc-sub">Пока ничего не заказано под этот договор.</div>'; return; }
    box.innerHTML = '<div class="detail-block-title"><i class="ti ti-truck"></i> Закупка по договору <span class="sc-sub">' + Number(d.done || 0) + ' из ' + Number(d.total || items.length) + ' пришло</span></div>' +
      items.map(it => root.scWaitRowHtml(it)).join('');
  }
  root.scContractSupply = scContractSupply;
})(typeof window !== 'undefined' ? window : globalThis);
