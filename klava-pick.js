/* «Показать Клаве» (v2.46.161) — общий модуль для CRM и Атом Чиллера.
   Человек ставит метки прямо на экране: клик по элементу, рамка мышью по
   области, клик по детали в 3D-сцене. Модуль собирает контекст (экран,
   элемент, селектор, подсказка по коду, данные детали), снимает скриншот с
   метками и отправляет всё в чат идей — в общую тему или новую идею.
   Клава на бэкенде получает метки текстом + скриншот и читает код по ним.

   Подключение: KlavaPick.init({apiBase, token, page, screen, project, version,
   role, partAt, hostCanvas, sceneShot, checks, fabStyle}). Всё необязательное,
   кроме apiBase/token. Ничего в самой странице модуль не меняет. */
(function () {
  'use strict';
  if (window.KlavaPick) return;

  const CSS = `
.kp-ui{font:12.5px/1.45 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1F2937;box-sizing:border-box}
.kp-ui *{box-sizing:border-box}
#kp-fab{position:fixed;right:18px;bottom:18px;z-index:99980;background:#FBBF24;color:#1F2937;border:0;border-radius:999px;
  padding:10px 16px;font:800 13px Inter,system-ui,sans-serif;box-shadow:0 8px 20px rgba(0,0,0,.25);cursor:pointer}
#kp-fab:hover{background:#F59E0B}
#kp-fab.hidden{display:none}
#kp-layer{position:fixed;inset:0;z-index:99990;cursor:crosshair;background:rgba(15,30,50,.12)}
#kp-bar{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99992;background:#0F1E32;color:#fff;border-radius:999px;
  padding:9px 16px;font-weight:700;display:flex;gap:12px;align-items:center;box-shadow:0 8px 24px rgba(0,0,0,.3);white-space:nowrap;max-width:96vw;overflow:hidden}
#kp-bar i{width:8px;height:8px;border-radius:50%;background:#FBBF24;display:inline-block;flex:none}
#kp-bar .k{background:rgba(255,255,255,.14);border-radius:6px;padding:2px 7px;font-weight:600}
.kp-done{border:0;background:#FBBF24;color:#1F2937;border-radius:8px;padding:4px 10px;font:800 12px Inter,system-ui,sans-serif;cursor:pointer}
.kp-reset{border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;border-radius:8px;padding:3px 9px;font:700 12px Inter,system-ui,sans-serif;cursor:pointer}
#kp-hover{position:fixed;z-index:99991;pointer-events:none;border:2px dashed #FBBF24;border-radius:8px;background:rgba(251,191,36,.08);display:none}
#kp-band{position:fixed;z-index:99991;pointer-events:none;border:2px solid #60A5FA;background:rgba(96,165,250,.14);border-radius:6px;display:none}
#kp-marks{position:fixed;inset:0;z-index:99989;pointer-events:none}
.kp-mark{position:fixed;border:2px solid #FBBF24;border-radius:10px;box-shadow:0 0 0 4px rgba(251,191,36,.28);pointer-events:none}
.kp-mark.region{border-color:#60A5FA;box-shadow:0 0 0 4px rgba(96,165,250,.28)}
.kp-mark.part{border-color:#F472B6;box-shadow:0 0 0 4px rgba(244,114,182,.28)}
.kp-mark .tag{position:absolute;left:-2px;top:-24px;background:#FBBF24;color:#1F2937;font:800 11px Inter,system-ui,sans-serif;padding:3px 8px;border-radius:7px 7px 0 0;white-space:nowrap;max-width:420px;overflow:hidden;text-overflow:ellipsis}
.kp-mark.region .tag{background:#60A5FA;color:#0F1E32}
.kp-mark.part .tag{background:#F472B6;color:#3B0A2A}
.kp-mark .pin{position:absolute;right:-12px;top:-12px;width:26px;height:26px;border-radius:50%;background:#DC2626;color:#fff;font:800 13px Inter,system-ui,sans-serif;display:grid;place-items:center;border:2px solid #fff;pointer-events:auto;cursor:pointer}
.kp-mark .pin:hover{background:#7F1D1D}
.kp-mark .pin:hover::after{content:'✕';font-size:12px}
.kp-mark .pin:hover .n{display:none}
#kp-panel{position:fixed;right:14px;top:14px;bottom:14px;width:420px;max-width:calc(100vw - 28px);z-index:99995;background:#fff;border-radius:16px;
  box-shadow:0 16px 48px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden}
#kp-panel.hidden{display:none}
.kp-ph{padding:12px 14px;border-bottom:1px solid #E5E9F0;display:flex;align-items:center;gap:10px;font-weight:800;font-size:14px}
.kp-ph .ava{width:30px;height:30px;border-radius:10px;background:#5B5BD6;color:#fff;display:grid;place-items:center;font-size:14px;flex:none}
.kp-ph .x{margin-left:auto;background:none;border:0;color:#9AA7B8;font-size:18px;cursor:pointer;line-height:1}
.kp-topic{margin:10px 14px 4px;display:flex;align-items:center;gap:8px;font-size:11.5px;color:#4B5563}
.kp-topic select{flex:1;min-width:0;border:1px solid #D9E1EC;border-radius:8px;padding:5px 8px;font:600 12px Inter,system-ui,sans-serif;color:#1E4E8C;background:#EEF4FF}
.kp-ctx{margin:6px 14px;background:#F5F7FA;border:1px solid #E5E9F0;border-radius:12px;padding:9px 12px;font-size:12px}
.kp-ctx .t{font-size:10px;font-weight:800;letter-spacing:.5px;color:#7E93AC;margin-bottom:5px;display:flex;align-items:center}
.kp-ctx .t button{margin-left:auto;border:0;background:#0F1E32;color:#fff;border-radius:7px;padding:3px 9px;font:700 11px Inter,system-ui,sans-serif;cursor:pointer}
.kp-ctx .t button.on{background:#FBBF24;color:#1F2937}
.kp-ctx .row{display:flex;gap:8px;margin:3px 0;min-width:0}
.kp-ctx .row span:first-child{color:#7E93AC;width:64px;flex:none}
.kp-ctx .row b{font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis}
.kp-ctx .m{display:flex;gap:6px;align-items:flex-start;margin:3px 0;min-width:0}
.kp-ctx .m .n{flex:none;width:18px;height:18px;border-radius:50%;background:#DC2626;color:#fff;font:800 11px Inter,system-ui,sans-serif;display:grid;place-items:center}
.kp-ctx .m .n.region{background:#2563EB}.kp-ctx .m .n.part{background:#DB2777}
.kp-ctx .m .l{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kp-ctx .m .d{color:#7E93AC;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kp-ctx .m .rm{border:0;background:none;color:#9AA7B8;cursor:pointer;font-size:14px;line-height:1;flex:none}
.kp-ctx .empty{color:#9AA7B8;font-style:italic}
.kp-feed{flex:1;overflow-y:auto;padding:8px 14px}
.kp-bub{background:#F1F5F9;border-radius:12px;padding:8px 11px;margin-bottom:8px;max-width:92%;white-space:pre-wrap;word-wrap:break-word}
.kp-bub.me{background:linear-gradient(135deg,#2D5F8B,#234C71);color:#fff;margin-left:auto}
.kp-bub .who{font-size:10.5px;font-weight:800;color:#5B5BD6;margin-bottom:2px}
.kp-bub.me .who{color:#BFDBFE}
.kp-bub .chip{display:inline-block;background:rgba(0,0,0,.08);border-radius:6px;padding:1px 7px;font-size:10.5px;font-weight:700;margin-top:4px}
.kp-bub.me .chip{background:rgba(255,255,255,.18)}
.kp-bub img{max-width:100%;border-radius:8px;margin-top:6px;display:block}
.kp-cmp{margin:0 14px 12px;border:1px solid #D9E1EC;border-radius:12px;padding:8px 10px;display:flex;align-items:flex-end;gap:8px}
.kp-cmp textarea{flex:1;border:0;outline:0;resize:none;font:12.5px/1.4 Inter,system-ui,sans-serif;max-height:120px;min-height:22px;background:transparent}
.kp-cmp button{flex:none;width:32px;height:32px;border-radius:9px;background:#2D5F8B;color:#fff;border:0;cursor:pointer;font-size:15px}
.kp-cmp button:disabled{opacity:.5;cursor:default}
.kp-note{margin:6px 14px;font-size:11.5px;color:#7E93AC}
.kp-acts{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 14px 4px}
.kp-acts .kp-note{margin:0}
.kp-act{border:1px solid #D9E1EC;background:#EEF4FF;color:#1E4E8C;border-radius:9px;padding:6px 10px;font:700 12px Inter,system-ui,sans-serif;cursor:pointer}
.kp-act.go{background:#2D5F8B;color:#fff;border-color:#2D5F8B;box-shadow:0 0 0 3px rgba(45,95,139,.18)}
.kp-act:disabled{opacity:.5;cursor:default}
.kp-spec{font-size:11.5px;line-height:1.4;max-height:220px;overflow:auto;background:#fff;border:1px solid #E5E9F0;border-radius:8px;padding:8px;margin-top:4px;white-space:pre-wrap}
.kp-hint{font-size:11px;color:#7E93AC;margin-top:4px}
.kp-live{flex-basis:100%;font-size:11.5px}
.kp-live:empty{display:none}
.kp-live-on{color:#B45309;font-weight:800}
.kp-live-wait{color:#7E93AC;font-weight:700}
.kp-live-done{color:#047857;font-weight:800}
.kp-live-line{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#4B5563;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kp-lock{margin:14px;background:#FEF3C7;border-radius:12px;padding:12px;color:#92400E;font-weight:600}
@media (max-width:640px){#kp-panel{right:0;left:0;top:auto;bottom:0;width:auto;max-width:none;height:72vh;border-radius:16px 16px 0 0}
  .kp-mark .tag{max-width:60vw}
  #kp-fab.kp-fab-crm{right:78px!important;bottom:86px!important;width:46px!important;height:46px!important;min-width:46px;padding:0!important;
    display:grid;place-items:center;font-size:0!important;line-height:1;box-shadow:0 5px 15px rgba(120,82,0,.24)}
  #kp-fab.kp-fab-crm::before{content:'✦';font-size:22px;line-height:1}
  body.dchat-ag .dchat-input{padding-right:52px}
}
`;

  const KP = window.KlavaPick = {
    cfg: null, marks: [], seq: 0, picking: false, open: false, tid: null, threads: [],
    busy: false, els: {}, drag: null, hoverEl: null, raf: 0, feedThread: null,
  };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = (tag, cls, html) => { const d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; };
  const isOurs = node => !!(node && node.closest && node.closest('.kp-ui'));

  KP.init = function (cfg) {
    KP.cfg = Object.assign({ page: 'crm', apiBase: '', fabStyle: null, fabText: '✦ Показать Клаве', enabled: true }, cfg || {});
    if (document.getElementById('kp-style')) return;
    const st = el('style'); st.id = 'kp-style'; st.textContent = CSS; document.head.appendChild(st);
    const fab = el('button', 'kp-ui', esc(KP.cfg.fabText)); fab.id = 'kp-fab'; fab.title = 'Отметить на экране, что обсудить с Клавой';
    fab.setAttribute('aria-label', 'Показать Клаве');
    if (KP.cfg.page === 'crm') fab.classList.add('kp-fab-crm');
    if (KP.cfg.fabStyle) Object.assign(fab.style, KP.cfg.fabStyle);
    fab.onclick = () => KP.toggle();
    // v2.46.176: remote — модуль живёт внутри чужой страницы (предпросмотр сайта в
    // iframe): без кнопки и панели, метки отдаются наружу через cfg.onDone
    if (KP.cfg.remote) fab.classList.add('hidden');
    document.body.appendChild(fab);
    const marks = el('div', 'kp-ui'); marks.id = 'kp-marks'; document.body.appendChild(marks);
    KP.els.fab = fab; KP.els.marks = marks;
    KP.syncVisibility();
    addEventListener('resize', KP.layout); addEventListener('scroll', KP.layout, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && KP.picking) { e.stopPropagation(); KP.pick(false); } }, true);
  };

  // v2.46.193: на странице входа кнопки Клавы быть не должно. В CRM enabled
  // зависит от state.user; после входа и выхода оболочка вызывает этот метод.
  KP._isEnabled = function () {
    try { return typeof KP.cfg.enabled === 'function' ? !!KP.cfg.enabled() : KP.cfg.enabled !== false; }
    catch (e) { return false; }
  };
  KP.syncVisibility = function () {
    if (!KP.els.fab) return;
    const enabled = KP._isEnabled();
    if (!enabled) {
      if (KP.picking) KP.pick(false);
      KP.open = false;
      clearInterval(KP._liveT); KP._liveT = null;
      if (KP.els.panel) KP.els.panel.classList.add('hidden');
    }
    KP.els.fab.classList.toggle('hidden', !enabled || !!KP.cfg.remote || KP.open || KP.picking);
  };

  // ---------- панель ----------
  KP.toggle = function () { KP.open ? KP.close() : KP.show(); };
  KP.show = async function () {
    if (!KP._isEnabled()) { KP.syncVisibility(); return; }
    KP.open = true;
    if (!KP.els.panel) KP._buildPanel();
    KP.els.panel.classList.remove('hidden');
    KP.els.fab.classList.add('hidden');
    KP._renderCtx();
    // v2.46.164: открываемся сразу на последней переписке выбранной темы;
    // режим меток — кнопкой «＋ Метка» (или сам, если тема пустая)
    try { await KP._loadThreads(); }
    catch (e) { KP.els.feed.innerHTML = '<div class="kp-lock">Нет связи с CRM — метки поставить можно, отправка не пройдёт</div>'; }
    const th = KP.feedThread;
    const fresh = !KP.tid || !th || !(th.messages || []).some(m => m.role === 'user');
    let auto = false;
    try { auto = !!(KP.cfg.autoPick && KP.cfg.autoPick()); } catch (e) { auto = false; }   // v2.46.175: на листах щита — сразу метки
    if (!KP.marks.length && (fresh || auto)) KP.pick(true);
  };
  KP._memKey = function () { return 'kp.topic.' + ((KP.cfg && KP.cfg.page) || 'crm'); };
  KP._remember = function () { try { localStorage.setItem(KP._memKey(), KP.tid ? String(KP.tid) : ''); } catch (e) {} };
  KP.close = function () {
    KP.open = false; KP.pick(false);
    clearInterval(KP._liveT); KP._liveT = null;
    if (KP.els.panel) KP.els.panel.classList.add('hidden');
    KP.syncVisibility();
  };
  KP._buildPanel = function () {
    const p = el('div', 'kp-ui'); p.id = 'kp-panel';
    p.innerHTML =
      '<div class="kp-ph"><div class="ava">✦</div>Обсудить с Клавой<button class="x" title="Закрыть">✕</button></div>' +
      '<div class="kp-topic">В тему: <select id="kp-topic"><option value="">загружаю…</option></select></div>' +
      '<div class="kp-ctx" id="kp-ctx"></div>' +
      '<div class="kp-feed" id="kp-feed"></div>' +
      '<div class="kp-acts" id="kp-acts"></div>' +
      '<div class="kp-note" id="kp-note"></div>' +
      '<div class="kp-cmp"><textarea id="kp-in" rows="1" placeholder="Что не так или чего не хватает?"></textarea>' +
      '<button id="kp-send" title="Отправить (Enter)">➤</button></div>';
    document.body.appendChild(p);
    KP.els.panel = p;
    p.querySelector('.x').onclick = KP.close;
    KP.els.topic = p.querySelector('#kp-topic');
    KP.els.topic.onchange = () => { KP.tid = KP.els.topic.value ? parseInt(KP.els.topic.value, 10) : null; KP._remember(); KP._loadFeed(); };
    KP.els.in = p.querySelector('#kp-in');
    KP.els.in.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); KP.send(); } });
    KP.els.in.addEventListener('input', () => { KP.els.in.style.height = 'auto'; KP.els.in.style.height = Math.min(120, KP.els.in.scrollHeight) + 'px'; });
    p.querySelector('#kp-send').onclick = KP.send;
    KP.els.feed = p.querySelector('#kp-feed'); KP.els.note = p.querySelector('#kp-note');
  };

  KP._api = async function (path, opts) {
    const c = KP.cfg, tok = typeof c.token === 'function' ? c.token() : c.token;
    const o = Object.assign({ cache: 'no-store' }, opts || {});
    o.headers = Object.assign({}, o.headers || {}, tok ? { Authorization: 'Bearer ' + tok } : {});
    let r;
    try { r = await fetch((c.apiBase || '') + path, o); }
    catch (e) { return { ok: false, status: 0, data: { message: 'Нет связи с CRM' } }; }
    let d = null; try { d = await r.json(); } catch (e) { d = null; }
    return { ok: r.ok, status: r.status, data: d || {} };
  };

  KP._loadThreads = async function () {
    const sel = KP.els.topic;
    const r = await KP._api('/api/ideas');
    if (!r.ok) {
      const msg = r.status === 403 ? (r.data.message || 'Чат идей закрыт паролем — спросите у директора') : ('Нет связи с CRM (' + r.status + ')');
      KP.els.feed.innerHTML = '<div class="kp-lock">' + esc(msg) + (r.status === 403 ? '<br><small>Пароль вводится в CRM: Главная → Идеи.</small>' : '') + '</div>';
      sel.innerHTML = '<option value="">—</option>';
      return;
    }
    const list = (r.data.ideas || []);
    KP.threads = list; KP.isDir = !!r.data.is_director;
    const shared = list.filter(t => t.shared), own = list.filter(t => !t.shared && ['open', 'ready', 'revision'].includes(t.status || 'open'));
    let h = '';
    if (shared.length) h += '<optgroup label="Общие темы">' + shared.map(t => '<option value="' + t.id + '">' + esc(t.title) + (t.rounds ? ' · ' + t.rounds + ' в работе' : '') + '</option>').join('') + '</optgroup>';
    if (own.length) h += '<optgroup label="Мои идеи">' + own.map(t => '<option value="' + t.id + '">' + esc(t.title) + '</option>').join('') + '</optgroup>';
    h += '<option value="">＋ новая идея</option>';
    sel.innerHTML = h;
    let mem = null; try { mem = parseInt(localStorage.getItem(KP._memKey()) || '', 10) || null; } catch (e) { mem = null; }
    if (KP.tid && list.some(t => t.id === KP.tid)) sel.value = String(KP.tid);
    else if (mem && list.some(t => t.id === mem)) { KP.tid = mem; sel.value = String(mem); }   // где общались в прошлый раз
    else {
      const pref = KP.cfg.preferTopic ? shared.find(t => new RegExp(KP.cfg.preferTopic, 'i').test(t.title || '')) : null;
      KP.tid = pref ? pref.id : (shared[0] ? shared[0].id : null);
      sel.value = KP.tid ? String(KP.tid) : '';
    }
    KP._remember();
    await KP._loadFeed();
  };

  KP._loadFeed = async function () {
    const feed = KP.els.feed;
    if (!KP.tid) {
      feed.innerHTML = '<div class="kp-bub"><div class="who">Клава</div>Новая идея: отметьте на экране, что обсуждаем, и напишите пару слов — я посмотрю, как это устроено сейчас, и предложу решение.</div>';
      return;
    }
    feed.innerHTML = '<div class="kp-note">загружаю переписку…</div>';
    const r = await KP._api('/api/ideas/' + KP.tid);
    if (!r.ok) { feed.innerHTML = '<div class="kp-lock">Не удалось открыть тему</div>'; return; }
    const th = r.data.thread || {}; KP.feedThread = th;
    feed.innerHTML = '';
    (th.messages || []).slice(-40).forEach(m => KP._bubble(m.role, m.text, m.author_name, m.context, m.files));
    if (th.spec_text && th.status === 'ready') KP._specBubble(th.spec_text);
    KP._renderActs();
    feed.scrollTop = feed.scrollHeight;
  };
  KP._specBubble = function (spec) {
    const b = KP._bubble('assistant', '', 'Клава');
    b.innerHTML = '<div class="who">Клава · ТЗ готово</div><div class="kp-spec">' + esc(spec) + '</div>' +
      (KP.isDir ? '<div class="kp-hint">Нажмите «Внедрить» ниже — задача уйдёт агенту, тема останется открытой.</div>'
                : '<div class="kp-hint">ТЗ у директора: он нажмёт «Внедрить».</div>');
    return b;
  };

  // v2.46.164: ТЗ и «Внедрить» прямо из панели — не ходить в раздел «Идеи»
  KP._renderActs = function () {
    const box = KP.els.panel && KP.els.panel.querySelector('#kp-acts'); if (!box) return;
    const th = KP.feedThread || {};
    if (!KP.tid || !th.id) { box.innerHTML = ''; return; }
    const talked = (th.messages || []).some(m => m.role === 'user');
    const ready = !!th.spec_text && th.status === 'ready';
    let h = '';
    // v2.46.173: тема щита — правка сразу в работу под личным кодом, без ТЗ
    if (th.panel) {
      if (talked) h += '<button class="kp-act go" id="kp-apply" title="Список Клавы и метки уйдут агенту; подпись — ваш личный код">⚡ Внести правку</button>';
      h += '<span class="kp-note">щит ' + esc(th.panel.designation || '') + (th.rounds ? ' · правок в работе: ' + th.rounds : '') + '</span>';
    } else {
      if (talked) h += '<button class="kp-act" id="kp-spec">📄 ' + (th.spec_text ? 'Пересобрать ТЗ' : 'Сформировать ТЗ') + '</button>';
      if (ready && KP.isDir) h += '<button class="kp-act go" id="kp-impl">🚀 Внедрить</button>';
      if (ready && !KP.isDir) h += '<span class="kp-note">ТЗ готово — внедряет директор</span>';
      if (th.rounds) h += '<span class="kp-note">раундов в работе: ' + th.rounds + '</span>';
    }
    if (th.rounds) h += '<button class="kp-act" id="kp-report">📋 Отчёт</button>';
    h += '<div class="kp-live" id="kp-live"></div>';
    box.innerHTML = h;
    KP._liveStart(th);
    const rb = box.querySelector('#kp-report'); if (rb) rb.onclick = KP.report;
    const sb = box.querySelector('#kp-spec'); if (sb) sb.onclick = KP.compile;
    const ib = box.querySelector('#kp-impl'); if (ib) ib.onclick = KP.implement;
    const ab = box.querySelector('#kp-apply'); if (ab) ab.onclick = KP.apply;
  };

  // v2.46.183: живой ход правки — агент взял? что делает сейчас? Опрос отчёта раз в 10 с
  KP._liveStart = function (th) {
    clearInterval(KP._liveT); KP._liveT = null;
    if (!th || !th.rounds || !KP.tid) return;
    const tid = KP.tid;
    const tick = async () => {
      const el = document.getElementById('kp-live');
      if (!el || KP.tid !== tid || !KP.open) { clearInterval(KP._liveT); KP._liveT = null; return; }
      let r; try { r = await KP._api('/api/ideas/' + tid + '/report'); } catch (e) { return; }
      if (!r.ok) return;
      const a = r.data.active;
      if (!a) {
        if (el.dataset.was === '1') { el.innerHTML = '<span class="kp-live-done">✅ Агент закончил — отчёт в теме</span>'; el.dataset.was = '0'; KP._loadFeed(); }
        else el.innerHTML = '';
        clearInterval(KP._liveT); KP._liveT = null; return;
      }
      el.dataset.was = '1';
      const mins = a.run_at ? Math.max(0, Math.round((Date.now() - new Date(String(a.run_at).replace(' ', 'T') + (String(a.run_at).endsWith('Z') ? '' : 'Z')).getTime()) / 60000)) : null;
      const last = (a.progress || []).slice(-1)[0] || '';
      el.innerHTML = a.status === 'running' || a.status === 'stopping'
        ? '<span class="kp-live-on">🔧 Агент работает над раундом ' + a.round + (mins != null ? ' · ' + mins + ' мин' : '') + '</span>' + (last ? '<div class="kp-live-line">' + esc(last).slice(0, 140) + '</div>' : '')
        : '<span class="kp-live-wait">⏳ Раунд ' + a.round + ' в очереди у агента</span>';
    };
    tick();
    KP._liveT = setInterval(tick, 10000);
  };

  // v2.46.181: отчёт по теме прямо в ленте — раунды с датами
  KP.report = async function () {
    if (!KP.tid) return;
    const r = await KP._api('/api/ideas/' + KP.tid + '/report');
    if (!r.ok) { KP.els.note.textContent = 'Отчёт недоступен'; return; }
    const rounds = r.data.rounds || [];
    const when = iso => { if (!iso) return '—'; const d = new Date(String(iso).replace(' ', 'T') + 'Z'); return isNaN(d) ? String(iso).slice(0, 16) : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };
    const st = { done: '✅ сделано', error: '⚠ не получилось', stopped: '⏹ остановлено', new: '⏳ в очереди', running: '🔧 в работе' };
    const lines = rounds.length ? rounds.map(x => 'Раунд ' + x.round + ' · ' + (st[x.status] || '🔧 в работе') + '\n' + (x.title || '') +
      '\nв работу: ' + when(x.started_at) + (x.started_by ? ' (' + x.started_by + ')' : '') + (x.done_at ? ' → готово: ' + when(x.done_at) : '') +
      (x.summary ? '\n' + x.summary.slice(0, 500) + (x.summary.length > 500 ? '…' : '') : '')).join('\n\n') : 'В работу ещё ничего не уходило.';
    const b = KP._bubble('assistant', '', 'Клава');
    b.innerHTML = '<div class="who">📋 Отчёт по теме</div>' + esc(lines);
  };

  // личный код: задать (если ещё нет) и подтвердить правку
  KP._askPin = async function () {
    const th = KP.feedThread || {};
    if (!th.pin_set) {
      const p1 = prompt('Личный код ещё не задан. Придумайте код из 4–6 цифр — им вы будете подписывать правки чертежей:', '');
      if (p1 === null) return null;
      if (!/^\d{4,6}$/.test(p1)) { alert('Код — от 4 до 6 цифр'); return null; }
      const p2 = prompt('Повторите код:', '');
      if (p2 !== p1) { alert('Коды не совпали'); return null; }
      const r = await KP._api('/api/me/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p1 }) });
      if (!r.ok) { alert(r.data.message || 'Код не сохранился'); return null; }
      th.pin_set = true;
      return p1;
    }
    const p = prompt('Введите ваш личный код — подпись под правкой:', '');
    return p === null ? null : p.trim();
  };

  KP.apply = async function () {
    if (KP.busy || !KP.tid) return;
    const pin = await KP._askPin();
    if (!pin) return;
    const note = prompt('Примечание агенту (можно пусто):', '') || '';
    KP.busy = true; KP.els.note.textContent = 'Отправляю правку в работу…';
    try {
      const r = await KP._api('/api/ideas/' + KP.tid + '/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pin, note: note.trim() }) });
      if (r.status === 428) { KP.feedThread.pin_set = false; KP.els.note.textContent = r.data.message || 'Задайте личный код'; return; }
      if (!r.ok || !r.data.ok) { KP.els.note.textContent = r.data.message || ('Не получилось (' + r.status + ')'); return; }
      KP.els.note.textContent = 'Правка ушла в работу — раунд ' + r.data.round + '. Новая ревизия появится в журнале щита.';
      await KP._loadFeed();
    } catch (e) { KP.els.note.textContent = 'Ошибка связи'; }
    finally { KP.busy = false; }
  };
  KP.compile = async function () {
    if (KP.busy || !KP.tid) return;
    KP.busy = true; KP.els.note.textContent = 'Клава собирает ТЗ из обсуждения…';
    const btn = KP.els.panel.querySelector('#kp-spec'); if (btn) btn.disabled = true;
    try {
      const r = await KP._api('/api/ideas/' + KP.tid + '/compile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skip_mockup: true }) });
      if (!r.ok || !r.data.ok) { KP.els.note.textContent = r.data.message || ('Не собралось (' + r.status + ')'); return; }
      KP.els.note.textContent = 'ТЗ готово.';
      await KP._loadFeed();
    } catch (e) { KP.els.note.textContent = 'Ошибка связи'; }
    finally { KP.busy = false; if (btn) btn.disabled = false; }
  };
  KP.implement = async function () {
    if (KP.busy || !KP.tid) return;
    const note = prompt('Правка к ТЗ перед внедрением (можно пусто):', '');
    if (note === null) return;
    KP.busy = true; KP.els.note.textContent = 'Отправляю в работу…';
    try {
      const r = await KP._api('/api/ideas/' + KP.tid + '/implement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment: note || '' }) });
      if (!r.ok || !r.data.ok) { KP.els.note.textContent = r.data.message || ('Не получилось (' + r.status + ')'); return; }
      KP.els.note.textContent = r.data.round ? ('Раунд ' + r.data.round + ' ушёл в работу — тема открыта дальше') : 'Задача в ленте разработки';
      await KP._loadThreads();
    } catch (e) { KP.els.note.textContent = 'Ошибка связи'; }
    finally { KP.busy = false; }
  };

  KP._bubble = function (role, text, who, ctx, files) {
    const feed = KP.els.feed;
    const me = role === 'user';
    const b = el('div', 'kp-bub' + (me ? ' me' : ''));
    let h = '<div class="who">' + esc(me ? (who || 'Вы') : 'Клава') + '</div>' + esc(text || '');
    if (ctx && ctx.marks && ctx.marks.length) h += '<br><span class="chip">📍 ' + ctx.marks.length + ' ' + (ctx.marks.length === 1 ? 'метка' : 'метки') + ' · ' + esc(ctx.screen || '') + '</span>';
    (files || []).forEach(f => { if (f.url && /image\//.test(f.content_type || '')) h += '<img src="' + esc((KP.cfg.apiBase || '') + f.url) + '" alt="">'; });
    b.innerHTML = h;
    feed.appendChild(b); feed.scrollTop = feed.scrollHeight;
    return b;
  };

  // ---------- метки ----------
  KP.pick = function (on) {
    on = typeof on === 'boolean' ? on : !KP.picking;
    if (on === KP.picking) return;
    KP.picking = on;
    // пока ставим метки, панель убираем — она закрывала бы правую треть экрана
    if (KP.els.panel) KP.els.panel.classList.toggle('hidden', on || !KP.open);
    if (on) {
      const layer = el('div', 'kp-ui'); layer.id = 'kp-layer';
      const bar = el('div', 'kp-ui'); bar.id = 'kp-bar';
      bar.innerHTML = '<i></i> Кликните на элемент' + (KP.cfg.partAt ? ' или деталь в сцене' : '') + ', или обведите область мышью <span class="k" id="kp-cnt"></span>' +
        '<button class="kp-reset" id="kp-reset" title="Убрать все метки">↺ Сбросить</button>' +
        '<button class="kp-done" id="kp-done">✓ Готово</button><span class="k">или Esc</span>';
      const hov = el('div', 'kp-ui'); hov.id = 'kp-hover';
      const band = el('div', 'kp-ui'); band.id = 'kp-band';
      document.body.append(layer, bar, hov, band);
      KP.els.layer = layer; KP.els.bar = bar; KP.els.hover = hov; KP.els.band = band;
      layer.addEventListener('pointermove', KP._onMove);
      layer.addEventListener('pointerdown', KP._onDown);
      layer.addEventListener('pointerup', KP._onUp);
      layer.addEventListener('contextmenu', e => e.preventDefault());
      // v2.46.174: колесо под слоем крутит ту прокрутку, что под курсором
      // (листы щита лежат в своём контейнере, а не в body)
      layer.addEventListener('wheel', KP._onWheel, { passive: false });
      bar.querySelector('#kp-done').onclick = () => KP.pick(false);
      bar.querySelector('#kp-reset').onclick = () => { KP.clear(); const c = document.getElementById('kp-cnt'); if (c) c.textContent = ''; };
    } else {
      ['layer', 'bar', 'hover', 'band'].forEach(k => { if (KP.els[k]) { KP.els[k].remove(); KP.els[k] = null; } });
      KP.drag = null; KP.hoverEl = null;
      if (KP.open && KP.els.in) setTimeout(() => KP.els.in.focus(), 50);
      if (KP.cfg && KP.cfg.remote) KP._remoteDone();
    }
    KP._renderCtx();
  };

  KP._scrollerAt = function (x, y) {
    let n = KP._under(x, y);
    while (n && n !== document.body && n !== document.documentElement) {
      const st = getComputedStyle(n);
      if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 1) return n;
      n = n.parentElement;
    }
    return null;
  };
  KP._onWheel = function (e) {
    const sc = KP._scrollerAt(e.clientX, e.clientY);
    e.preventDefault();
    if (sc) sc.scrollBy({ top: e.deltaY, left: e.deltaX });
    else window.scrollBy({ top: e.deltaY, left: e.deltaX });
    KP.layout();
  };

  KP._remoteDone = async function () {
    if (!KP.cfg || typeof KP.cfg.onDone !== 'function') return;
    const ctx = KP.context();
    let shot = null;
    if (KP.marks.length) {
      try {
        const f = await KP.shot();
        if (f) shot = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f); });
      } catch (e) { shot = null; }
    }
    try { KP.cfg.onDone(ctx, shot); } catch (e) {}
  };

  KP._under = function (x, y) {
    const layer = KP.els.layer; if (!layer) return null;
    layer.style.pointerEvents = 'none';
    let node = document.elementFromPoint(x, y);
    layer.style.pointerEvents = '';
    while (node && isOurs(node)) node = node.parentElement;
    return node && node !== document.documentElement ? node : null;
  };

  KP._onMove = function (e) {
    if (KP.drag) {
      const d = KP.drag, dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (!d.moved && Math.hypot(dx, dy) > 8) d.moved = true;
      if (d.moved) {
        const r = [Math.min(d.x0, e.clientX), Math.min(d.y0, e.clientY), Math.abs(dx), Math.abs(dy)];
        const b = KP.els.band; b.style.display = 'block';
        b.style.left = r[0] + 'px'; b.style.top = r[1] + 'px'; b.style.width = r[2] + 'px'; b.style.height = r[3] + 'px';
        KP.els.hover.style.display = 'none';
      }
      return;
    }
    const node = KP._under(e.clientX, e.clientY);
    KP.hoverEl = node;
    const h = KP.els.hover;
    if (!node) { h.style.display = 'none'; return; }
    const r = node.getBoundingClientRect();
    h.style.display = 'block'; h.style.left = (r.left - 2) + 'px'; h.style.top = (r.top - 2) + 'px';
    h.style.width = (r.width + 4) + 'px'; h.style.height = (r.height + 4) + 'px';
  };
  KP._onDown = function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    try { KP.els.layer.setPointerCapture(e.pointerId); } catch (_) {}
    KP.drag = { x0: e.clientX, y0: e.clientY, moved: false };
  };
  KP._onUp = function (e) {
    const d = KP.drag; KP.drag = null;
    if (!d) return;
    KP.els.band.style.display = 'none';
    if (d.moved) {
      const rect = [Math.min(d.x0, e.clientX), Math.min(d.y0, e.clientY), Math.abs(e.clientX - d.x0), Math.abs(e.clientY - d.y0)];
      if (rect[2] < 6 || rect[3] < 6) return;
      const inside = KP._elsIn(rect);
      const m = { kind: 'region', rect, label: 'область ' + Math.round(rect[2]) + '×' + Math.round(rect[3]),
                  text: inside.text, selector: inside.selectors };
      KP._anchor(m);
      KP.add(m);
      return;
    }
    const node = KP._under(e.clientX, e.clientY);
    if (!node) return;
    // 3D-сцена: деталь под курсором
    if (KP.cfg.partAt && KP.cfg.hostCanvas && node.matches && node.matches(KP.cfg.hostCanvas)) {
      let part = null; try { part = KP.cfg.partAt(e.clientX, e.clientY); } catch (_) { part = null; }
      if (part) {
        KP.add(Object.assign({ kind: 'part' }, part, { rect: part.rectFn ? part.rectFn() : [e.clientX - 40, e.clientY - 40, 80, 80] }));
        return;
      }
      const m2 = { kind: 'region', rect: [e.clientX - 60, e.clientY - 60, 120, 120], label: 'точка в сцене', detail: 'мимо деталей — пустое место сцены' };
      KP._anchor(m2); KP.add(m2);
      return;
    }
    KP.add(KP._describe(node));
  };

  KP._elsIn = function (rect) {
    const [x, y, w, h] = rect, sel = new Set(), texts = [];
    document.querySelectorAll('button,a,input,select,textarea,h1,h2,h3,h4,label,[id],[data-nav],[data-screen]').forEach(n => {
      if (isOurs(n)) return;
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (r.left >= x - 2 && r.top >= y - 2 && r.right <= x + w + 2 && r.bottom <= y + h + 2) {
        const s = KP._selector(n); if (s && sel.size < 12) sel.add(s);
        const t = (n.innerText || n.value || '').trim(); if (t && texts.length < 12 && texts.indexOf(t.slice(0, 40)) < 0) texts.push(t.slice(0, 40));
      }
    });
    return { selectors: [...sel].join(', '), text: texts.join(' | ').slice(0, 300) };
  };

  KP._selector = function (n) {
    if (!n || n.nodeType !== 1) return '';
    if (n.id) return '#' + n.id;
    const ds = ['data-nav', 'data-screen', 'data-section', 'data-tab', 'data-f', 'data-t', 'data-fp-status'];
    for (const a of ds) if (n.hasAttribute(a)) return n.tagName.toLowerCase() + '[' + a + '="' + n.getAttribute(a) + '"]';
    const cls = [...n.classList].filter(c => !/^(active|on|visible|hidden|open|is-|has-)/.test(c)).slice(0, 3);
    return n.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '');
  };

  KP._describe = function (node) {
    // осмысленный предок: с id, data-атрибутом, кнопка/ссылка/заголовок
    let anc = node, best = null;
    for (let i = 0; anc && i < 6; i++, anc = anc.parentElement) {
      if (anc.id || anc.hasAttribute('data-nav') || anc.hasAttribute('data-screen') || /^(BUTTON|A|H1|H2|H3|LABEL|SELECT|INPUT|TEXTAREA|TR|LI)$/.test(anc.tagName)) { best = anc; break; }
    }
    const target = best || node;
    const chain = [];
    let a = target;
    for (let i = 0; a && a !== document.body && i < 4; i++, a = a.parentElement) { const s = KP._selector(a); if (s && chain.indexOf(s) < 0) chain.push(s); }
    const text = (target.innerText || target.value || target.getAttribute('title') || target.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const tag = target.tagName.toLowerCase();
    const kindWord = { button: 'кнопка', a: 'ссылка', input: 'поле', select: 'список', textarea: 'поле', h1: 'заголовок', h2: 'заголовок', h3: 'заголовок', tr: 'строка таблицы', li: 'пункт' }[tag] || 'блок';
    const r = target.getBoundingClientRect();
    let code = '';
    try { code = KP.cfg.codeHint ? (KP.cfg.codeHint(target) || '') : ''; } catch (_) { code = ''; }
    return { kind: 'el', el: target, rect: [r.left, r.top, r.width, r.height],
             label: kindWord + (text ? ' «' + text.slice(0, 60) + '»' : ' ' + chain[0]),
             text, selector: chain.join(' ← '), code };
  };

  // v2.46.169: страница может дополнить метку (лист чертежа, координаты в мм)
  KP.under = function (x, y) { return KP._under(x, y); };
  KP.openTopic = async function (tid) {
    KP.tid = tid ? parseInt(tid, 10) : null;
    KP._remember();
    await KP.show();
  };
  KP.add = function (m) {
    m.n = ++KP.seq;
    if (KP.cfg && typeof KP.cfg.markExtra === 'function') {
      try { KP.cfg.markExtra(m); } catch (e) {}
    }
    KP.marks.push(m);
    if (KP.marks.length > 8) KP.marks.shift();
    KP.layout(); KP._renderCtx();
    const cnt = document.getElementById('kp-cnt');
    if (cnt) cnt.textContent = 'меток: ' + KP.marks.length;
  };
  KP.remove = function (n) {
    KP.marks = KP.marks.filter(m => m.n !== n); KP.layout(); KP._renderCtx();
    const c = document.getElementById('kp-cnt'); if (c) c.textContent = KP.marks.length ? 'меток: ' + KP.marks.length : '';
    if (KP.cfg && KP.cfg.remote && !KP.picking) KP._remoteDone();
  };
  KP.clear = function () { KP.marks = []; KP.seq = 0; KP.layout(); KP._renderCtx(); };

  // v2.46.174: рамка области держится за элемент под ней (лист, карточка),
  // а не за экран — прокрутка и ресайз её не сдвигают
  KP._anchor = function (m) {
    const r = m.rect || [0, 0, 0, 0];
    let a = KP._under(r[0] + r[2] / 2, r[1] + r[3] / 2);
    if (!a || a === document.body) return;
    const ar = a.getBoundingClientRect();
    if (!ar.width || !ar.height) return;
    m.anchor = a;
    m.anchorFr = [(r[0] - ar.left) / ar.width, (r[1] - ar.top) / ar.height, r[2] / ar.width, r[3] / ar.height];
  };
  KP.layout = function () {
    const host = KP.els.marks; if (!host) return;
    host.innerHTML = '';
    KP.marks.forEach(m => {
      if (m.el && m.el.isConnected) { const r = m.el.getBoundingClientRect(); m.rect = [r.left, r.top, r.width, r.height]; }
      else if (m.rectFn) { try { const r = m.rectFn(); if (r) m.rect = r; } catch (_) {} }
      else if (m.anchor && m.anchor.isConnected && m.anchorFr) {
        const ar = m.anchor.getBoundingClientRect(), f = m.anchorFr;
        m.rect = [ar.left + f[0] * ar.width, ar.top + f[1] * ar.height, f[2] * ar.width, f[3] * ar.height];
      }
      const [x, y, w, h] = m.rect || [0, 0, 0, 0];
      const d = el('div', 'kp-mark ' + m.kind);
      d.style.left = (x - 4) + 'px'; d.style.top = (y - 4) + 'px'; d.style.width = (w + 8) + 'px'; d.style.height = (h + 8) + 'px';
      d.innerHTML = '<div class="tag">' + esc(m.label || '') + '</div><div class="pin" title="Убрать метку ' + m.n + '"><span class="n">' + m.n + '</span></div>';
      d.querySelector('.pin').onclick = (e) => { e.stopPropagation(); KP.remove(m.n); };
      host.appendChild(d);
    });
    // 3D-детали двигаются вместе с камерой — перекладываем, пока панель открыта
    if (KP.marks.some(m => m.rectFn) && KP.open) {
      cancelAnimationFrame(KP.raf);
      KP.raf = requestAnimationFrame(() => setTimeout(KP.layout, 120));
    }
  };

  KP.context = function () {
    const c = KP.cfg;
    const get = f => { try { return typeof f === 'function' ? f() : f; } catch (_) { return ''; } };
    const ctx = { page: c.page, screen: get(c.screen) || document.title, project: get(c.project) || '',
                  url: location.pathname + location.hash, version: get(c.version) || '', role: get(c.role) || '',
                  viewport: innerWidth + '×' + innerHeight,
                  marks: KP.marks.map(m => ({ n: m.n, kind: m.kind, label: m.label, text: m.text, selector: m.selector, code: m.code, detail: m.detail,
                                              rect: (m.rect || []).map(v => Math.round(v)) })) };
    const ch = get(c.checks); if (ch && typeof ch === 'object') ctx.checks = ch;
    return ctx;
  };

  KP._renderCtx = function () {
    const box = KP.els.panel && KP.els.panel.querySelector('#kp-ctx'); if (!box) return;
    const ctx = KP.context();
    let h = '<div class="t">КЛАВА УВИДИТ САМА <button id="kp-pickbtn" class="' + (KP.picking ? 'on' : '') + '">' + (KP.picking ? '● отмечаю… (Esc)' : '＋ Метка') + '</button></div>' +
      '<div class="row"><span>Экран</span><b>' + esc(ctx.screen) + '</b></div>' +
      (ctx.project ? '<div class="row"><span>Проект</span><b>' + esc(ctx.project) + '</b></div>' : '');
    if (!KP.marks.length) h += '<div class="empty">Без меток — просто разговор. «＋ Метка»: кликнуть на элемент или обвести область.</div>';
    KP.marks.forEach(m => {
      h += '<div class="m"><span class="n ' + m.kind + '">' + m.n + '</span><span class="l">' + esc(m.label) +
        (m.detail || m.selector || m.code ? '<div class="d">' + esc([m.detail, m.code, m.selector].filter(Boolean).join(' · ')) + '</div>' : '') +
        '</span><button class="rm" data-n="' + m.n + '" title="Убрать метку">✕</button></div>';
    });
    if (ctx.checks) h += '<div class="row"><span>Проверки</span><b>' + esc(Object.keys(ctx.checks).map(k => k + ': ' + ctx.checks[k]).join(' · ')) + '</b></div>';
    box.innerHTML = h;
    box.querySelector('#kp-pickbtn').onclick = () => KP.pick();
    box.querySelectorAll('.rm').forEach(b => { b.onclick = () => KP.remove(parseInt(b.dataset.n, 10)); });
  };

  // ---------- скриншот с метками ----------
  KP._h2c = function () {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    return new Promise(res => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload = () => res(window.html2canvas || null); s.onerror = () => res(null);
      document.head.appendChild(s);
    });
  };
  KP.shot = async function () {
    let base = null;
    try {
      const h2c = await KP._h2c();
      if (h2c) base = await h2c(document.body, { useCORS: true, logging: false, scale: 1, backgroundColor: null,
        ignoreElements: n => isOurs(n), x: scrollX, y: scrollY, width: innerWidth, height: innerHeight, windowWidth: innerWidth, windowHeight: innerHeight });
    } catch (_) { base = null; }
    const c = document.createElement('canvas'); c.width = innerWidth; c.height = innerHeight;
    const g = c.getContext('2d'); g.fillStyle = '#0D1B30'; g.fillRect(0, 0, c.width, c.height);
    if (base) g.drawImage(base, 0, 0, c.width, c.height);
    // 3D-сцена: html2canvas может не снять WebGL — подкладываем снимок из самой сцены
    if (KP.cfg.sceneShot && KP.cfg.hostCanvas) {
      try {
        const cv = document.querySelector(KP.cfg.hostCanvas);
        const f = await KP.cfg.sceneShot();
        if (cv && f) {
          const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = URL.createObjectURL(f); });
          const r = cv.getBoundingClientRect();
          if (img) g.drawImage(img, r.left, r.top, r.width, r.height);
        }
      } catch (_) {}
    }
    // метки поверх
    KP.marks.forEach(m => {
      const [x, y, w, h] = m.rect || [0, 0, 0, 0];
      const col = m.kind === 'region' ? '#60A5FA' : (m.kind === 'part' ? '#F472B6' : '#FBBF24');
      g.lineWidth = 3; g.strokeStyle = col; g.strokeRect(x - 3, y - 3, w + 6, h + 6);
      g.fillStyle = '#DC2626'; g.beginPath(); g.arc(x + w + 2, y - 2, 13, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = 'bold 14px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(m.n), x + w + 2, y - 2);
      g.fillStyle = col; g.font = 'bold 11px sans-serif'; g.textAlign = 'left';
      const tw = Math.min(400, g.measureText(m.label || '').width + 10);
      g.fillRect(x - 3, y - 22, tw, 18); g.fillStyle = '#1F2937'; g.fillText((m.label || '').slice(0, 70), x + 2, y - 13);
    });
    const k = Math.min(1, 1600 / Math.max(c.width, c.height));
    let out = c;
    if (k < 1) { out = document.createElement('canvas'); out.width = Math.round(c.width * k); out.height = Math.round(c.height * k); out.getContext('2d').drawImage(c, 0, 0, out.width, out.height); }
    return new Promise(res => out.toBlob(b => res(b ? new File([b], 'экран с метками.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.85));
  };

  // ---------- отправка ----------
  // ждём ответ Клавы опросом темы: каждые 3 с, до 15 минут
  KP._waitReply = async function (tid, msgId, ph) {
    const t0 = Date.now();
    const phrases = ['Смотрю метки и код…', 'Читаю генератор листа…', 'Сверяю с правилами…', 'Думаю над ответом…'];
    let i = 0;
    while (Date.now() - t0 < 15 * 60 * 1000) {
      await new Promise(res => setTimeout(res, 3000));
      if (ph) { ph.innerHTML = '<div class="who">Клава</div>' + esc(phrases[i++ % phrases.length]) + ' <span class="kp-hint">' + Math.round((Date.now() - t0) / 1000) + ' с</span>'; }
      let r; try { r = await KP._api('/api/ideas/' + tid); } catch (e) { continue; }
      if (!r.ok) continue;
      const th = r.data.thread || {};
      const after = (th.messages || []).filter(m => m.role === 'assistant' && m.id > msgId);
      if (after.length) { KP.feedThread = th; KP._renderActs(); return after[after.length - 1].text; }
      if (!th.pending) {
        // сервер перезапустился, ответ потерялся — не висим вечно
        return 'Ответ не дошёл (сервер перезапустился). Напишите ещё раз.';
      }
    }
    return 'Клава думает слишком долго — обновите тему чуть позже.';
  };

  KP.send = async function () {
    if (KP.busy) return;
    const text = (KP.els.in.value || '').trim();
    if (!text && !KP.marks.length) return;
    KP.busy = true; KP.pick(false);
    const btn = KP.els.panel.querySelector('#kp-send'); btn.disabled = true;
    KP.els.note.textContent = 'снимаю экран с метками…';
    try {
      const ctx = KP.context();
      const shot = KP.marks.length ? await KP.shot() : null;
      KP.els.in.value = ''; KP.els.in.style.height = 'auto';
      const mine = KP._bubble('user', text || '(метки на экране)', 'Вы', ctx, null);
      if (shot) { const img = document.createElement('img'); img.src = URL.createObjectURL(shot); mine.appendChild(img); }
      const ph = KP._bubble('assistant', 'Смотрю метки и код…', 'Клава');
      KP.els.note.textContent = 'Клава смотрит…';
      const fd = new FormData();
      fd.append('text', text || 'Смотри метки на экране.');
      fd.append('context', JSON.stringify(ctx));
      if (KP.tid) fd.append('async', '1');   // v2.46.178: ответ приходит опросом — прокси не оборвёт долгий ответ
      if (shot) fd.append('file_1', shot, shot.name);
      const url = KP.tid ? '/api/ideas/' + KP.tid + '/message' : '/api/ideas';
      const r = await KP._api(url, { method: 'POST', body: fd });
      if (!r.ok) { ph.innerHTML = '<div class="who">Клава</div>' + esc(r.data.message || ('Не отправилось (' + r.status + ')')); return; }
      if (!KP.tid && r.data.thread_id) { KP.tid = r.data.thread_id; await KP._loadThreads(); }
      let reply = r.data.reply;
      if (r.data.pending) reply = await KP._waitReply(KP.tid, r.data.msg_id, ph);
      ph.innerHTML = '<div class="who">Клава</div>' + esc(reply || 'Приняла.');
      KP.els.feed.scrollTop = KP.els.feed.scrollHeight;
      KP.clear();
      KP.els.note.textContent = KP.tid ? 'Отправлено в тему.' : '';
      if (KP.tid) { try { const t = await KP._api('/api/ideas/' + KP.tid); if (t.ok) { KP.feedThread = t.data.thread || KP.feedThread; KP._renderActs(); } } catch (e) {} }
    } catch (e) {
      KP.els.note.textContent = 'Ошибка связи: ' + (e && e.message || e);
    } finally {
      KP.busy = false; btn.disabled = false;
    }
  };
})();
