/* v2.46.284 — «Снабжение → Что закупить», вариант 1 «по «Куда»» (выбор Дмитрия, 03.11.2026).
 *
 * Отдельный слой поверх app-3.js / supply-chain.js. Старый экран не удалён:
 * он рендерится как раньше и прячется в #sup-shop-content > .sbv-legacy, его
 * функции (окно заказа, выбор поставщика по договору, «Зависли») продолжают работать.
 * Кнопка «Старый вид» возвращает прежний экран (localStorage supplyBuyV1 = '0').
 *
 *   • сверху 5 плиток-счётчиков: Купить / Ждём счёт / На оплату / Оплачено, едет / Требуют решения;
 *   • поиск и чипы-фильтры по «Куда» (договоры, Склад, Цех, Без «Куда»), «Только проблемы»;
 *   • группы по «Куда» (или по этапу / по поставщику) с полоской этапов;
 *   • компактная строка: статус-чип, кол-во, сумма, дни ожидания и ОДНА кнопка следующего шага;
 *   • заказ раскрывается списком позиций.
 * Цвет только для смысла: серый — купить, янтарный — ждём счёт, синий — на оплату,
 * фиолетовый — оплачено/едет, зелёный — пришло, красный — проблема.
 *
 * Кнопки только открывают существующие окна (превью письма, карточку заказа,
 * черновик напоминания, выбор поставщика) — сами ничего не отправляют и не пишут.
 */
(function (root) {
  'use strict';

  const STAGES = ['buy', 'inv', 'pay', 'go', 'ok'];
  const STAGE_LABEL = { buy: 'Купить', inv: 'Ждём счёт', pay: 'На оплату', go: 'Оплачено, едет', ok: 'Пришло' };
  const STAGE_SHORT = { buy: 'купить', inv: 'ждём счёт', pay: 'на оплату', go: 'едет', ok: 'пришло' };
  const STATUS_STAGE = {
    draft: 'inv', sent: 'inv', awaiting_invoice: 'inv', invoice_requested: 'inv',
    invoice_received: 'pay', approval: 'pay', to_pay: 'pay',
    paid: 'go', shipping: 'go', partial: 'go',
    received: 'ok',
  };
  const PROBLEM_LABEL = { dup: 'дубли', nodest: 'без «Куда»', nosup: 'нет поставщика', late: 'долго едет' };
  const DAY = 86400000;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function plural(n, f) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return f[2];
    if (b > 1 && b < 5) return f[1];
    if (b === 1) return f[0];
    return f[2];
  }
  function money(n) {
    const x = Number(n);
    if (!isFinite(x) || x <= 0) return '';
    return Math.round(x).toLocaleString('ru-RU').replace(/\u00A0|\u202F/g, ' ') + ' ₽';
  }
  function fmtQty(n) {
    const x = Number(n);
    if (!isFinite(x)) return '';
    return (Math.round(x * 100) / 100).toLocaleString('ru-RU').replace(/\u00A0|\u202F/g, ' ');
  }
  function parseTs(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (!m) return null;
    // Время в базе — UTC (как и у остального снабжения)
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  }
  function ddmm(s) {
    const t = parseTs(s);
    if (t == null) return '';
    const d = new Date(t + 5 * 3600000);  // Екатеринбург
    return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }
  function hhmm(s) {
    if (!/\d{2}:\d{2}/.test(String(s || ''))) return '';
    const d = new Date(parseTs(s) + 5 * 3600000);
    return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }
  function norm(s) {
    return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'()]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function contractKey(num) {
    return String(num || '').replace(/^\s*№\s*/, '').replace(/\s+/g, '').trim();
  }
  function shortSupplier(name) {
    let s = String(name || '').replace(/^(ООО|ОАО|АО|ЗАО|ПАО|ИП)\s+/i, '').replace(/,\s*(ООО|АО|ИП)$/i, '').trim();
    s = s.replace(/^[«"]|[»"]$/g, '');
    return s.length > 18 ? s.slice(0, 16) + '…' : s;
  }
  function unitShort(u) {
    return String(u || 'шт').replace(/\.$/, '') || 'шт';
  }

  // ---------------------------------------------------------------- модель
  /** Назначение заказа по его строкам (из /api/supply/waiting), иначе по самому заказу. */
  function orderDest(o, lines) {
    const cnt = {};
    (lines || []).forEach(l => {
      const t = l.dest_type || (l.dest && l.dest.type) || null;
      if (!t) return;
      const k = t === 'contract' ? 'c:' + contractKey(l.dest_contract_number || (l.dest && l.dest.label)) : t;
      if (!cnt[k]) cnt[k] = { n: 0, type: t, number: l.dest_contract_number || (l.dest && l.dest.label) || '', contractor: l.dest_contractor_name || '', contract_id: l.dest_contract_id || null };
      cnt[k].n++;
    });
    const best = Object.values(cnt).sort((a, b) => b.n - a.n)[0];
    if (best) return { type: best.type, number: best.number, contractor: best.contractor, contract_id: best.contract_id, partial: best.n < (lines || []).length };
    if (o && o.dest_type) return { type: o.dest_type, number: o.contract_number || '', contractor: '', contract_id: o.contract_id || null, partial: false };
    if (o && o.contract_number) return { type: 'contract', number: o.contract_number, contractor: '', contract_id: o.contract_id || null, partial: false };
    return { type: null };
  }
  function destKey(d) {
    if (!d || !d.type) return 'none';
    if (d.type === 'contract') return 'c:' + contractKey(d.number);
    return d.type === 'shop' ? 'shop' : (d.type === 'stock' ? 'stock' : 'none');
  }
  function orderTitle(o, lines) {
    if (o.purpose) return String(o.purpose);
    if (lines.length === 1) return lines[0].name;
    const c = String(o.comment || '');
    if (c && !/^Сч[её]т на оплату из входящего/i.test(c) && !/^\[архив/.test(c)) return c.split(' — ')[0].split(' · ')[0];
    if (lines.length > 1) return lines.length + ' ' + plural(lines.length, ['позиция', 'позиции', 'позиций']) + ' · ' + lines[0].name;
    return o.order_label || ('ORD-' + o.id);
  }
  function lineNamesKey(lines) {
    return (lines || []).map(l => norm(l.name)).filter(Boolean).sort().join('|');
  }

  /**
   * Собирает строки экрана.
   * input: { shop, cp, waiting, orders, closed, hidden(fn), now }
   *   shop    — /api/supply/shopping-list
   *   cp      — позиции /api/supply/contract-purchases (массив)
   *   waiting — /api/supply/waiting
   *   orders  — /api/supply-orders?status=open (массив)
   *   closed  — /api/supply-orders?status=closed (массив, можно пусто)
   */
  function sbBuildRows(input) {
    const now = input.now || Date.now();
    const rows = [];
    const waitLines = ((input.waiting && input.waiting.items) || []);
    const byOrder = {};
    waitLines.forEach(l => { (byOrder[l.order_id] = byOrder[l.order_id] || []).push(l); });

    // ---- заказы
    const orders = (input.orders || []).filter(o => STATUS_STAGE[o.status] && o.status !== 'received' && !o.merged_into_order_id);
    const orderRows = orders.map(o => {
      let lines = (byOrder[o.id] || []).map(l => ({ name: l.name, qty: l.remaining != null ? l.remaining : l.qty, unit: l.unit, sku: l.sku, dest_type: l.dest_type, dest: l.dest, dest_contract_number: l.dest_contract_number, dest_contractor_name: l.dest_contractor_name, dest_contract_id: l.dest_contract_id }));
      const fromInvoice = !lines.length;
      if (fromInvoice) lines = (o.invoice_items || []).map(x => ({ name: x.name, qty: x.qty, unit: x.unit }));
      const stage = STATUS_STAGE[o.status];
      const dest = fromInvoice ? orderDest(o, []) : orderDest(o, lines);
      const units = new Set(lines.map(l => unitShort(l.unit)));
      const qtySum = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
      const days = o.step && o.step.days != null ? Number(o.step.days) : null;
      const amount = Number(o.invoice_total) > 0 ? Number(o.invoice_total) : (Number(o.total_amount) > 0 ? Number(o.total_amount) : 0);
      const sup = o.supplier_name || o.invoice_seller_name || '';
      let when = '';
      if (stage === 'inv') when = (o.sent_at || o.awaiting_invoice_at || o.created_at) ? 'запрос ' + ddmm(o.sent_at || o.created_at) + (hhmm(o.sent_at || o.created_at) ? ' ' + hhmm(o.sent_at || o.created_at) : '') : '';
      else if (stage === 'pay') when = 'счёт ' + ddmm(o.invoice_received_at || o.to_pay_at || o.created_at);
      else if (stage === 'go') when = 'оплачен ' + ddmm(o.paid_at || (o.step && o.step.since));
      return {
        key: 'o' + o.id, kind: 'order', order_id: o.id, label: o.order_label || ('ORD-' + o.id),
        stage, status: o.status, title: orderTitle(o, lines), supplier: sup, supplier_id: o.supplier_id,
        when, purpose: o.purpose || '', lines, fromInvoice, dest,
        qty: lines.length && units.size === 1 && qtySum ? fmtQty(qtySum) + ' ' + [...units][0] : '',
        amount, days, expected: o.expected_date || null, created: parseTs(o.created_at) || 0,
        closedPair: null, dupOf: null, problems: [], _names: lineNamesKey(lines),
        _raw: o,
      };
    });

    // ---- дубли среди открытых: тот же поставщик, создан в пределах 2 минут, те же позиции
    const sorted = orderRows.slice().sort((a, b) => a.created - b.created || a.order_id - b.order_id);
    sorted.forEach((r, i) => {
      for (let j = 0; j < i; j++) {
        const p = sorted[j];
        if (p.dupOf) continue;
        const sameSup = p.supplier_id && p.supplier_id === r.supplier_id;
        const near = Math.abs(r.created - p.created) <= 120000;
        const sameItems = r._names && r._names === p._names;
        if (sameSup && near && (sameItems || (!r._names && !p._names && p.amount === r.amount))) { r.dupOf = p; break; }
      }
      const raw = r._raw;
      if (!r.dupOf && raw.duplicate && raw.duplicate.order_id) {
        const p = orderRows.find(x => x.order_id === raw.duplicate.order_id);
        if (p) r.dupOf = p;
      }
    });
    orderRows.forEach(r => {
      if (r.dupOf) {
        r.problems.push('dup');
        r.dupLabel = 'Дубль';
        r.title = r.label + ' — копия ' + r.dupOf.label;
        r.sub = 'те же ' + (r.lines.length ? r.lines.length + ' ' + plural(r.lines.length, ['позиция', 'позиции', 'позиций']) + ' ' : 'позиции ') + (shortSupplier(r.supplier) || '') + ', создан в ту же минуту';
        if (!r.dest.type) r.dest = r.dupOf.dest;
      }
    });

    // ---- оплачено, а пара с той же позицией закрыта архивом/приходом без прихода
    const closed = (input.closed || []).filter(c => {
      const t = parseTs(c.closed_at || c.updated_at);
      return t != null && now - t <= 14 * DAY;
    });
    orderRows.forEach(r => {
      if (r.dupOf || r.stage !== 'go' || !r._names) return;
      const names = new Set(r._names.split('|'));
      const pair = closed.find(c => c.id !== r.order_id && (c.invoice_items || []).some(x => names.has(norm(x.name))));
      if (pair) {
        r.closedPair = pair;
        r.problems.push('dup');
        r.dupLabel = 'Дубль · не пришло?';
        r.pairNote = 'пара ' + (pair.order_label || 'ORD-' + pair.id) + (/архив/i.test(pair.comment || '') ? ' закрыта архивом' : ' закрыта');
      }
    });

    orderRows.forEach(r => {
      if (!r.dupOf && !r.dest.type) r.problems.push('nodest');
      if (r.stage === 'go' && !r.expected && r.days != null && r.days >= 7) r.problems.push('late');
      // возраст
      if (r.stage === 'go') {
        if (r.expected) {
          const t = parseTs(r.expected);
          r.age = t != null && t < now - DAY ? { text: 'просрочено', cls: 'lr' } : { text: 'до ' + ddmm(r.expected), cls: '' };
        } else if (r.days != null && r.days >= 7) r.age = { text: r.days + ' дн', cls: 'lr' };
        else r.age = { text: 'нет даты', cls: 'la' };
      } else if (r.days != null && !r.dupOf) {
        r.age = { text: r.days + ' дн', cls: r.days >= 3 ? 'lr' : (r.days >= 1 ? 'la' : '') };
      } else r.age = { text: '', cls: '' };
      // подпись
      if (!r.sub) {
        const bits = [r.supplier || 'поставщик не указан', r.label];
        if (r.when) bits.push(r.when);
        if (r.pairNote) bits.push(r.pairNote);
        else if (r.purpose && r.title !== r.purpose) bits.push(r.purpose);
        if (r.stage === 'go' && r.fromInvoice && !r.lines.length) bits.push('позиций в счёте нет');
        r.sub = bits.join(' · ');
      }
      // следующий шаг — одна кнопка
      const id = Number(r.order_id);
      if (r.dupOf) r.action = { label: 'Отменить дубль', icon: 'x', primary: false, js: 'openSupplyOrder(' + id + ')' };
      else if (r.closedPair) r.action = { label: 'Пришла / не пришла', icon: 'help-circle', primary: false, js: 'openSupplyOrder(' + id + ')' };
      else if (r.stage === 'inv') r.action = { label: 'Напомнить' + (r.lines.length > 5 && shortSupplier(r.supplier) ? ' ' + shortSupplier(r.supplier) : ''), icon: 'bell', primary: true, js: 'sbRemind(' + id + ')' };
      else if (r.stage === 'pay') r.action = { label: 'Оплатить', icon: 'cash', primary: true, js: 'sbGoPay()' };
      else if (!r.dest.type) r.action = { label: 'Назначить «Куда»', icon: 'arrow-right', primary: true, js: 'openSupplyOrder(' + id + ')' };
      else if (!r.expected) r.action = { label: 'Указать дату', icon: 'calendar', primary: false, js: 'openSupplyOrder(' + id + ')' };
      else r.action = { label: 'Пришло', icon: 'package-import', primary: false, js: 'openSupplyOrder(' + id + ')' };
    });

    // дубль ставим сразу под оригиналом
    const used = new Set();
    orderRows.slice().sort((a, b) => b.created - a.created || b.order_id - a.order_id).forEach(r => {
      if (used.has(r.key) || r.dupOf) return;
      rows.push(r); used.add(r.key);
      orderRows.filter(d => d.dupOf === r).forEach(d => { rows.push(d); used.add(d.key); });
    });
    orderRows.forEach(r => { if (!used.has(r.key)) rows.push(r); });

    // ---- к закупке: комплектующие (склад / под план договора)
    const hidden = typeof input.hidden === 'function' ? input.hidden : () => false;
    ((input.shop && input.shop.groups) || []).forEach(g => {
      (g.items || []).forEach(it => {
        if (it.purchase_status === 'ordered' || (it.order_status && STATUS_STAGE[it.order_status])) return;
        if (hidden(it)) return;
        const plan = Array.isArray(it.plan_contracts) ? it.plan_contracts.filter(Boolean) : [];
        const dest = plan.length ? { type: 'contract', number: String(plan[0]), contractor: '' } : { type: 'stock' };
        const supId = g.supplier_id || null;
        const why = (it.min_stock > 0 && it.effective_stock != null)
          ? 'остаток ' + fmtQty(it.effective_stock) + ' при минимуме ' + fmtQty(it.min_stock)
          : (it.reason || '');
        const r = {
          key: 'c' + it.component_id + ':' + (supId || 0), kind: 'item', component_id: it.component_id,
          stage: 'buy', title: it.component_name || '—', sku: it.sku || '', supplier: supId ? g.supplier_name : '', supplier_id: supId,
          supplier_email: g.supplier_email || '', dest, lines: [], qty: fmtQty(it.recommended_qty || it.reorder_qty || 0) + ' ' + unitShort(it.unit),
          amount: 0, critical: !!it.is_critical, problems: [], age: { text: '', cls: '' },
        };
        r.sub = (supId ? g.supplier_name : '') + (supId && why ? ' · ' : '') + why + (supId ? '' : ' · <nosup>');
        if (!supId) {
          r.problems.push('nosup');
          r.action = { label: 'Выбрать поставщика', icon: 'building-store', primary: true, js: 'openComponentDetail(' + Number(it.component_id) + ')' };
        } else {
          r.action = { label: 'Запросить счёт', icon: 'send', primary: true, js: 'openCreateOrderPreview(' + Number(supId) + ')' };
        }
        rows.push(r);
      });
    });
    // ---- к закупке: покупные позиции договоров
    (input.cp || []).forEach(it => {
      if (it.purchase_status === 'ordered') return;
      const r = {
        key: 'p' + it.id, kind: 'cp', cp_id: it.id, stage: 'buy', title: it.item_name || '—', sku: it.nc_code || '',
        supplier: it.supplier_name || '', supplier_id: it.supplier_id || null,
        dest: { type: 'contract', number: it.contract_number || ('#' + it.contract_id), contractor: it.contractor_name || '', contract_id: it.contract_id },
        lines: [], qty: fmtQty(it.qty) + ' ' + unitShort(it.unit), amount: 0, problems: [], age: { text: '', cls: '' },
      };
      r.sub = (it.supplier_name ? it.supplier_name + ' · ' : '') + 'покупная позиция договора' + (it.supplier_id ? '' : ' · <nosup>');
      if (!it.supplier_id) {
        r.problems.push('nosup');
        r.action = { label: 'Выбрать поставщика', icon: 'building-store', primary: true, js: 'sbCpPick(' + Number(it.id) + ')' };
      } else {
        r.action = { label: 'Запросить счёт', icon: 'send', primary: true, js: 'createCpOrder(' + Number(it.supplier_id) + ')' };
      }
      rows.push(r);
    });

    rows.forEach(r => {
      r.dk = destKey(r.dest);
      r.bad = r.problems.length > 0 && (r.problems.includes('dup') || r.problems.includes('nosup') || r.problems.includes('late'));
      r.hay = norm([r.title, r.sub, r.supplier, r.label, r.sku, r.dest && r.dest.number, r.dest && r.dest.contractor,
        r.amount ? String(Math.round(r.amount)) : '', (r.lines || []).map(l => l.name + ' ' + (l.sku || '')).join(' ')].join(' '));
    });
    return rows;
  }

  function sbTiles(rows) {
    const t = {};
    STAGES.forEach(s => { t[s] = rows.filter(r => r.stage === s && !r.dupOf); });
    const prob = rows.filter(r => r.problems.length);
    const pc = {};
    prob.forEach(r => r.problems.forEach(p => { pc[p] = (pc[p] || 0) + 1; }));
    return {
      buy: { n: t.buy.length, critical: t.buy.filter(r => r.critical).length },
      inv: { n: t.inv.length, lines: t.inv.reduce((s, r) => s + r.lines.length, 0), since: t.inv.reduce((m, r) => (!m || (r.created && r.created < m) ? r.created : m), 0) },
      pay: { n: t.pay.length, sum: t.pay.reduce((s, r) => s + (r.amount || 0), 0) },
      go: { n: t.go.length, sum: t.go.reduce((s, r) => s + (r.amount || 0), 0), nodate: t.go.filter(r => !r.expected).length },
      problem: { n: prob.length, by: pc },
    };
  }

  /** Группы для режима: dest | stage | supplier. */
  function sbGroups(rows, mode) {
    const map = new Map();
    const add = (k, mk, r) => { if (!map.has(k)) map.set(k, mk()); map.get(k).rows.push(r); };
    rows.forEach(r => {
      if (mode === 'stage') {
        const k = r.problems.includes('dup') || r.problems.includes('nosup') ? 'problem' : r.stage;
        add(k, () => ({ key: k, kind: 'stage', stage: k, rows: [] }), r);
      } else if (mode === 'supplier') {
        const k = r.supplier ? 's:' + norm(r.supplier) : 's:-';
        add(k, () => ({ key: k, kind: 'supplier', title: r.supplier || 'Поставщик не выбран', rows: [] }), r);
      } else {
        add(r.dk, () => ({ key: r.dk, kind: r.dk.startsWith('c:') ? 'contract' : r.dk, number: r.dest && r.dest.number, contractor: r.dest && r.dest.contractor, rows: [] }), r);
        const g = map.get(r.dk);
        if (!g.contractor && r.dest && r.dest.contractor) g.contractor = r.dest.contractor;
      }
    });
    const list = [...map.values()];
    const rank = g => {
      if (mode === 'stage') return ['problem', 'buy', 'inv', 'pay', 'go', 'ok'].indexOf(g.key);
      if (mode === 'supplier') return g.key === 's:-' ? -1 : 0;
      return g.kind === 'contract' ? 0 : ({ stock: 1, shop: 2, none: 3 }[g.kind] || 4);
    };
    list.sort((a, b) => rank(a) - rank(b) || (mode === 'supplier' ? String(a.title).localeCompare(String(b.title), 'ru') : String(a.number || '').localeCompare(String(b.number || ''), 'ru')));
    const sord = { buy: 0, inv: 1, pay: 2, go: 3, ok: 4 };
    list.forEach(g => {
      if (mode !== 'dest') return;
      // внутри группы по этапу, дубль — под оригиналом
      const base = g.rows.filter(r => !r.dupOf).sort((a, b) => (sord[a.stage] - sord[b.stage]) || ((b.problems.length ? 1 : 0) - (a.problems.length ? 1 : 0)) || (b.created || 0) - (a.created || 0));
      const out = [];
      base.forEach(r => { out.push(r); g.rows.filter(d => d.dupOf === r).forEach(d => out.push(d)); });
      g.rows.filter(d => d.dupOf && !out.includes(d)).forEach(d => out.push(d));
      g.rows = out;
    });
    return list;
  }

  function sbFilter(rows, f) {
    f = f || {};
    const q = norm(f.q || '').replace(/(\d)\s+(?=\d)/g, '$1');
    return rows.filter(r => {
      if (f.dest && f.dest !== 'all' && r.dk !== f.dest) return false;
      if (f.tile === 'problem') { if (!r.problems.length) return false; }
      else if (f.tile && r.stage !== f.tile) return false;
      if (f.problems && !r.problems.length) return false;
      if (q && r.hay.replace(/(\d)\s+(?=\d)/g, '$1').indexOf(q) < 0) return false;
      return true;
    });
  }

  function sbChips(rows) {
    const map = new Map();
    rows.forEach(r => {
      if (!map.has(r.dk)) map.set(r.dk, { key: r.dk, n: 0, label: r.dk.startsWith('c:') ? '№' + contractKey(r.dest.number) : ({ stock: 'Склад', shop: 'Цех', none: 'Без «Куда»' }[r.dk]), icon: r.dk.startsWith('c:') ? 'file-text' : ({ stock: 'building-warehouse', shop: 'tool', none: 'alert-triangle' }[r.dk]) });
      map.get(r.dk).n++;
    });
    const rank = k => (k.startsWith('c:') ? 0 : ({ stock: 1, shop: 2, none: 3 }[k]));
    return [...map.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label, 'ru'));
  }

  // ---------------------------------------------------------------- HTML
  function ic(n) { return '<i class="ti ti-' + esc(n) + '"></i>'; }
  function chip(stage, label) { return '<span class="sbv-st ' + stage + '"><i class="dt"></i>' + esc(label) + '</span>'; }
  function rowChip(r) {
    if (r.dupLabel) return chip('bad', r.dupLabel);
    if (r.stage === 'buy' && r.critical) return chip('bad', 'Срочно');
    if (r.stage === 'go') {
      if (r.status === 'shipping') return chip('go', 'Едет');
      if (r.status === 'partial') return chip('go', 'Пришло частично');
      return chip('go', 'Оплачен, едет');
    }
    if (r.stage === 'pay') return chip('pay', r.status === 'to_pay' ? 'На оплату' : (r.status === 'approval' ? 'На согласовании' : 'Счёт получен'));
    return chip(r.stage, STAGE_LABEL[r.stage]);
  }
  function subHtml(r) {
    return esc(r.sub || '').replace('&lt;nosup&gt;', '<span class="sbv-tr">поставщик не выбран</span>').replace(/^ · /, '');
  }
  function rowHtml(r, open) {
    const hasLines = r.lines && r.lines.length > 1;
    const lead = r.dupOf ? ic('copy') : (hasLines ? '<button type="button" class="sbv-chev" aria-label="Позиции" onclick="event.stopPropagation();sbToggle(\'' + esc(r.key) + '\')">' + ic(open ? 'chevron-down' : 'chevron-right') + '</button>' : '');
    const a = r.action;
    const btn = a ? '<button type="button" class="sbv-btn' + (a.primary ? ' p' : '') + '" onclick="event.stopPropagation();' + esc(a.js) + '">' + ic(a.icon) + '<span>' + esc(a.label) + '</span></button>' : '';
    const clickable = r.kind === 'order' ? ' role="button" tabindex="0" onclick="openSupplyOrder(' + Number(r.order_id) + ')"' :
      (r.kind === 'item' ? ' role="button" tabindex="0" onclick="openComponentDetail(' + Number(r.component_id) + ')"' : '');
    let h = '<div class="sbv-row' + (r.bad ? ' bad' : '') + '" data-key="' + esc(r.key) + '"' + clickable + '>' +
      '<span class="sbv-lead">' + lead + '</span>' +
      '<div class="sbv-main"><div class="t">' + esc(r.title) + '</div><div class="s">' + subHtml(r) + '</div></div>' +
      '<div class="sbv-chip">' + rowChip(r) + '</div>' +
      '<div class="sbv-q' + (r.qty ? '' : ' nil') + '">' + (r.qty ? esc(r.qty) : '–') + '</div>' +
      '<div class="sbv-sum' + (r.amount ? '' : ' nil') + '">' + (r.amount ? esc(money(r.amount)) : '–') + '</div>' +
      '<div class="sbv-age ' + esc(r.age.cls || '') + '">' + esc(r.age.text || '') + '</div>' +
      '<div class="sbv-act">' + btn + '</div>' +
    '</div>';
    if (hasLines && open) {
      h += '<div class="sbv-mini">' + r.lines.map(l => '<div><span title="' + esc(l.name) + '">' + esc(l.name) + '</span><span class="m">' + esc(fmtQty(l.qty)) + ' ' + esc(unitShort(l.unit)) + '</span></div>').join('') + '</div>';
    }
    return h;
  }
  function progHtml(rows) {
    const c = {};
    rows.forEach(r => { if (r.dupOf) return; c[r.stage] = (c[r.stage] || 0) + Math.max(1, r.lines ? r.lines.length : 1); });
    const keys = STAGES.filter(s => c[s]);
    if (!keys.length) return '';
    return '<div class="sbv-progw"><div class="sbv-prog">' + keys.map(s => '<i class="' + s + '" style="flex:' + c[s] + '"></i>').join('') + '</div>' +
      '<div class="sbv-legend">' + keys.map(s => '<span><i class="' + s + '"></i>' + STAGE_SHORT[s] + ' ' + c[s] + '</span>').join('') + '</div></div>';
  }
  function groupHead(g) {
    const rows = g.rows;
    const orders = rows.filter(r => r.kind === 'order' && !r.dupOf).length;
    const dups = rows.filter(r => r.dupOf).length;
    const buy = rows.filter(r => r.stage === 'buy').length;
    const paid = rows.filter(r => !r.dupOf && r.stage === 'go').reduce((s, r) => s + (r.amount || 0), 0);
    const bits = [];
    if (orders) bits.push(orders + ' ' + plural(orders, ['заказ', 'заказа', 'заказов']) + (dups ? ' + ' + dups + ' ' + plural(dups, ['дубль', 'дубля', 'дублей']) : ''));
    if (buy) bits.push(buy + ' к закупке');
    if (paid) bits.push('оплачено ' + money(paid));
    let icon = 'file-text', title = '', sub = bits.join(' · '), warn = false;
    if (g.kind === 'contract') { title = 'Договор № ' + contractKey(g.number) + (g.contractor ? ' · ' + g.contractor : ''); }
    else if (g.kind === 'stock') { icon = 'building-warehouse'; title = 'Склад'; sub = 'пополнение по минимальным остаткам · ' + rows.length + ' ' + plural(rows.length, ['позиция', 'позиции', 'позиций']); }
    else if (g.kind === 'shop') { icon = 'tool'; title = 'Цех'; }
    else if (g.kind === 'none') { icon = 'alert-triangle'; title = 'Без «Куда»'; sub = 'непонятно, для чего куплено — назначьте договор, склад или цех'; warn = true; }
    else if (g.kind === 'stage') {
      icon = { problem: 'alert-octagon', buy: 'shopping-cart', inv: 'file-invoice', pay: 'cash', go: 'truck', ok: 'circle-check' }[g.stage];
      title = g.stage === 'problem' ? 'Требуют решения' : STAGE_LABEL[g.stage];
      warn = g.stage === 'problem';
      sub = rows.length + ' ' + plural(rows.length, ['строка', 'строки', 'строк']);
    } else if (g.kind === 'supplier') { icon = 'building-store'; title = g.title; warn = g.key === 's:-'; }
    return '<div class="sbv-gh"><span class="sbv-gi' + (warn ? ' warn' : '') + '">' + ic(icon) + '</span><div class="sbv-gtx"><div class="gt">' + esc(title) + '</div><div class="gs">' + esc(sub) + '</div></div>' +
      (g.kind === 'stage' ? '' : progHtml(rows)) + '</div>';
  }

  function sbTilesHtml(t, active) {
    const tile = (key, cls, label, val, unit, sub) =>
      '<button type="button" class="sbv-tile ' + cls + (active === key ? ' on' : '') + '" onclick="sbSet(\'tile\',\'' + key + '\')">' +
        '<i class="strip"></i><div class="k"><i class="dt"></i>' + esc(label) + '</div>' +
        '<div class="v">' + val + (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div><div class="s">' + esc(sub) + '</div></button>';
    const since = t.inv.since ? 'с ' + ddmmFromMs(t.inv.since) : '';
    const by = t.problem.by;
    const pb = Object.keys(PROBLEM_LABEL).filter(k => by[k]).map(k => PROBLEM_LABEL[k] + ' ' + by[k]).join(' · ');
    return '<div class="sbv-tiles">' +
      tile('buy', 'buy', 'Купить', t.buy.n, plural(t.buy.n, ['позиция', 'позиции', 'позиций']), (t.buy.critical ? t.buy.critical + ' срочно · ' : '') + 'не заказано') +
      tile('inv', 'inv', 'Ждём счёт', t.inv.n, plural(t.inv.n, ['заказ', 'заказа', 'заказов']), t.inv.lines + ' ' + plural(t.inv.lines, ['позиция', 'позиции', 'позиций']) + (since ? ' · ' + since : '')) +
      tile('pay', 'pay', 'На оплату', t.pay.n, t.pay.n ? plural(t.pay.n, ['счёт', 'счёта', 'счетов']) : '', t.pay.n ? (money(t.pay.sum) || 'сумма не распознана') : 'все счета оплачены') +
      tile('go', 'go', 'Оплачено, едет', t.go.n, plural(t.go.n, ['заказ', 'заказа', 'заказов']), (money(t.go.sum) || '0 ₽') + (t.go.nodate ? ' · даты нет у ' + t.go.nodate : '')) +
      tile('problem', 'bad', 'Требуют решения', t.problem.n, '', pb || 'всё в порядке') +
    '</div>';
  }
  function ddmmFromMs(ms) {
    const d = new Date(ms + 5 * 3600000);
    return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }

  // ---------------------------------------------------------------- состояние и DOM
  const S = { rows: [], f: { q: '', dest: 'all', tile: '', problems: false }, mode: 'dest', open: {}, loadedAt: 0, loading: false, raw: null };
  try { S.mode = localStorage.getItem('sbv_mode') || 'dest'; } catch (e) {}
  root.__sbState = S;

  function enabled() { try { return localStorage.getItem('supplyBuyV1') !== '0'; } catch (e) { return true; } }

  function paint() {
    const host = document.getElementById('sbv-root');
    if (!host) return;
    const rows = S.rows;
    const t = sbTiles(rows);
    const vis = sbFilter(rows, S.f);
    const chips = sbChips(rows);
    const groups = sbGroups(vis, S.mode);
    const dnote = S.loadedAt ? 'данные из CRM на ' + new Date(S.loadedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' }).replace(',', '') + ' Екб' : '';
    let h = '<div class="sbv-top"><span class="sbv-note">' + esc(dnote) + (S.loading ? ' · обновляем…' : '') + '</span><div class="sbv-sp"></div>' +
      '<div class="sbv-seg">' + [['dest', 'По «Куда»'], ['stage', 'По этапу'], ['supplier', 'По поставщику']].map(m => '<button type="button" class="' + (S.mode === m[0] ? 'on' : '') + '" onclick="sbSet(\'mode\',\'' + m[0] + '\')">' + m[1] + '</button>').join('') + '</div>' +
      '<button type="button" class="sbv-btn p sbv-new" onclick="openNewSupplyOrder()">' + ic('plus') + '<span>Новый заказ</span></button></div>';
    h += sbTilesHtml(t, S.f.tile);
    h += '<div class="sbv-chips"><label class="sbv-srch">' + ic('search') + '<input type="search" id="sbv-q" placeholder="Деталь, артикул, ORD, поставщик, договор, сумма" value="' + esc(S.f.q) + '" oninput="sbSearch(this.value)"></label>' +
      '<button type="button" class="sbv-chipb' + (S.f.dest === 'all' ? ' on' : '') + '" onclick="sbSet(\'dest\',\'all\')">Все <span class="m">' + rows.length + '</span></button>' +
      chips.map(c => '<button type="button" class="sbv-chipb' + (S.f.dest === c.key ? ' on' : '') + (c.key === 'none' ? ' warn' : '') + '" onclick="sbSet(\'dest\',' + esc(JSON.stringify(c.key)) + ')">' + ic(c.icon) + esc(c.label) + ' <span class="m">' + c.n + '</span></button>').join('') +
      '<div class="sbv-sp"></div>' +
      '<button type="button" class="sbv-chipb bad' + (S.f.problems ? ' on' : '') + '" onclick="sbSet(\'problems\')">' + ic('alert-octagon') + 'Только проблемы <span class="m">' + t.problem.n + '</span></button></div>';
    if (S.f.tile) {
      h += '<div class="sbv-fbar">' + ic('filter') + '<span>Показано: ' + esc(S.f.tile === 'problem' ? 'требуют решения' : STAGE_LABEL[S.f.tile].toLowerCase()) + '</span><button type="button" onclick="sbSet(\'tile\',\'\')">' + ic('x') + 'показать все</button></div>';
    }
    if (!groups.length) {
      h += '<div class="sbv-empty">' + ic(rows.length ? 'filter-off' : 'circle-check') + (rows.length ? 'Ничего не нашлось под этот фильтр' : 'Закупать нечего — всё заказано и пришло') + '</div>';
    }
    groups.forEach(g => {
      h += '<section class="sbv-grp">' + groupHead(g) + '<div class="sbv-rows">' + g.rows.map(r => rowHtml(r, !!S.open[r.key])).join('') + '</div></section>';
    });
    h += '<div class="sbv-foot"><button type="button" onclick="sbLegacy(true)">' + ic('history') + 'Старый вид экрана</button></div>';
    host.innerHTML = h;
    if (S._focusQ) { const i = document.getElementById('sbv-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } S._focusQ = false; }
  }

  function rebuild() {
    const r = S.raw || {};
    let hiddenSet = null;
    try { if (typeof root._shopGetHidden === 'function') hiddenSet = root._shopGetHidden(); } catch (e) {}
    S.rows = sbBuildRows({
      shop: r.shop, cp: r.cp, waiting: r.waiting, orders: r.orders, closed: r.closed,
      hidden: it => !!(hiddenSet && hiddenSet.has && hiddenSet.has(it.component_id)),
    });
    paint();
  }

  async function loadExtra() {
    const get = root.apiGet;
    if (typeof get !== 'function') return;
    S.loading = true;
    const [w, o, c] = await Promise.all([
      get('/api/supply/waiting').catch(() => null),
      get('/api/supply-orders?status=open').catch(() => null),
      get('/api/supply-orders?status=closed').catch(() => null),
    ]);
    S.loading = false;
    S.raw.waiting = w || { items: [], no_items: [] };
    S.raw.orders = (o && o.orders) || [];
    S.raw.closed = (c && c.orders) || [];
    S.loadedAt = Date.now();
    rebuild();
  }

  function mount(d) {
    const box = document.getElementById('sup-shop-content');
    if (!box) return;
    // старый экран — в скрытую обёртку (его функции и галочки остаются в DOM)
    let legacy = box.querySelector(':scope > .sbv-legacy');
    if (!legacy) {
      legacy = document.createElement('div');
      legacy.className = 'sbv-legacy';
      while (box.firstChild) legacy.appendChild(box.firstChild);
      box.appendChild(legacy);
    }
    legacy.hidden = true;
    let host = document.getElementById('sbv-root');
    if (!host) { host = document.createElement('div'); host.id = 'sbv-root'; box.insertBefore(host, legacy); }
    document.body.classList.add('sbv-on');
    S.raw = Object.assign(S.raw || {}, { shop: d.shop, cp: d.cp });
    if (!S.raw.orders) S.raw.orders = [];
    rebuild();
    loadExtra();
  }

  // ---------------------------------------------------------------- глобальные обработчики
  root.sbSet = function (k, v) {
    if (k === 'mode') { S.mode = v; try { localStorage.setItem('sbv_mode', v); } catch (e) {} }
    else if (k === 'tile') S.f.tile = S.f.tile === v ? '' : v;
    else if (k === 'dest') S.f.dest = v;
    else if (k === 'problems') S.f.problems = !S.f.problems;
    paint();
  };
  let _qT = null;
  root.sbSearch = function (v) {
    S.f.q = v;
    clearTimeout(_qT);
    _qT = setTimeout(() => { S._focusQ = true; paint(); }, 200);
  };
  root.sbToggle = function (key) { S.open[key] = !S.open[key]; paint(); };
  root.sbRemind = function (id) {
    if (typeof root.scReminderDraft === 'function') return root.scReminderDraft(id);
    if (typeof root.openSupplyOrder === 'function') return root.openSupplyOrder(id);
  };
  root.sbGoPay = function () { if (typeof root.selectSidebarItem === 'function') root.selectSidebarItem('supply-pay'); };
  root.sbCpPick = function (cpId) {
    document.querySelectorAll('.cp-check').forEach(c => { c.checked = String(c.getAttribute('data-cpid')) === String(cpId); });
    if (typeof root.openCpSupplierPicker === 'function') root.openCpSupplierPicker();
  };
  root.sbLegacy = function (on) {
    try { localStorage.setItem('supplyBuyV1', on ? '0' : '1'); } catch (e) {}
    if (typeof root.loadSupplyShopping === 'function') root.loadSupplyShopping();
  };

  // ---------------------------------------------------------------- подключение
  if (typeof document !== 'undefined') {
    const orig = root.renderSupplyShopping;
    if (typeof orig === 'function' && !orig._sbv) {
      const fn = function (d) {
        // исходные данные — до того как старый рендер вырежет из групп заказанное
        let copy = null;
        try { copy = JSON.parse(JSON.stringify({ shop: { groups: (d && d.groups) || [] }, cp: (d && d._contract_purchases) || [] })); } catch (e) {}
        const res = orig.apply(this, arguments);
        document.body.classList.remove('sbv-on');
        if (!enabled()) {
          const box = document.getElementById('sup-shop-content');
          if (box && !box.querySelector('.sbv-back')) {
            const b = document.createElement('div');
            b.className = 'sbv-back';
            b.innerHTML = '<button type="button" onclick="sbLegacy(false)"><i class="ti ti-layout-list"></i>Новый вид «по «Куда»»</button>';
            box.insertBefore(b, box.firstChild);
          }
          return res;
        }
        if (copy) { try { mount(copy); } catch (e) { console.warn('supply-buy', e); } }
        return res;
      };
      fn._sbv = true; fn._orig = orig; fn._sc283 = orig._sc283;
      root.renderSupplyShopping = fn;
    }
  }

  const api = { sbBuildRows, sbTiles, sbGroups, sbFilter, sbChips, sbTilesHtml, rowHtml, groupHead, orderDest, contractKey, STATUS_STAGE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__sbv = api;
})(typeof window !== 'undefined' ? window : globalThis);
