/* Atomus Group — связка сайта с CRM (v1).
   Подключение (перед </body> на каждой странице):
     <script src="atomus-site.js" data-key="КЛЮЧ_САЙТА" defer></script>
   Ключ выдаёт CRM: Сайты → «Код для сайта». Адрес сервера уже внутри (Railway напрямую).

   Что делает сам:
   - считает посещения: открытие страницы, «я ещё здесь» каждые 20 с, уход со страницы;
     из этого CRM собирает время на сайте, страницы, источник (Яндекс, Telegram, реклама…), устройство;
   - никаких персональных данных не собирает: только id посетителя в localStorage и id сессии.

   Что даёт форме заявки:
     AtomusSite.lead({scenario, contact_method, contact, name, comment, equipment, params, source, consent})
       → Promise<{ok, id, created, message}>. Повтор после сбоя не создаёт дубль (lead_key хранится в форме).
     AtomusSite.click('Позвонить инженеру') — отметить нажатие важной кнопки. */
(function () {
  'use strict';
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var KEY = (script && script.getAttribute('data-key')) || (window.ATOMUS_SITE_KEY || '');
  var API = ((script && script.getAttribute('data-api')) || window.ATOMUS_API_BASE || 'https://worker-production-9b70.up.railway.app').replace(/\/$/, '');
  if (!KEY) { if (window.console) console.warn('AtomusSite: нет data-key — посещения и заявки не отправляются'); }
  var base = API + '/api/site/' + encodeURIComponent(KEY);

  function rid() { try { var a = new Uint8Array(12); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); } catch (e) { return String(Date.now()) + Math.random().toString(16).slice(2); } }
  function store(kind, k, gen) { try { var s = kind === 'local' ? localStorage : sessionStorage; var v = s.getItem(k); if (!v) { v = gen(); s.setItem(k, v); } return v; } catch (e) { return gen(); } }
  var VID = store('local', 'atomus_vid', rid);
  var SID = store('session', 'atomus_sid', rid);
  var UTM = {};
  try { new URLSearchParams(location.search).forEach(function (v, k) { if (/^utm_/i.test(k)) UTM[k.toLowerCase()] = String(v).slice(0, 80); }); } catch (e) {}

  function send(payload, beacon) {
    if (!KEY) return Promise.resolve({ ok: false });
    var body = JSON.stringify(payload);
    if (beacon && navigator.sendBeacon) { try { navigator.sendBeacon(base + '/track', new Blob([body], { type: 'text/plain' })); return Promise.resolve({ ok: true }); } catch (e) {} }
    return fetch(base + '/track', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: body, keepalive: true, mode: 'cors' })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false }; });
  }
  function page() { return location.pathname + (location.hash && location.hash.length > 1 ? location.hash : ''); }
  function track(event, extra) {
    var p = { event: event, sid: SID, vid: VID, page: page(), title: (document.title || '').slice(0, 200), ref: document.referrer || '', utm: UTM, screen: (screen && screen.width ? screen.width + 'x' + screen.height : '') };
    if (extra) for (var k in extra) p[k] = extra[k];
    return send(p, event === 'leave');
  }

  // просмотр страницы + пинги, пока вкладка видна
  track('view');
  var timer = null;
  function startPing() { if (timer) return; timer = setInterval(function () { if (!document.hidden) track('ping'); }, 20000); }
  function stopPing() { if (timer) { clearInterval(timer); timer = null; } }
  startPing();
  document.addEventListener('visibilitychange', function () { if (document.hidden) { track('leave'); stopPing(); } else { track('ping'); startPing(); } });
  window.addEventListener('pagehide', function () { track('leave'); });
  // переходы по якорям и одностраничная навигация — тоже страницы
  var lastPage = page();
  window.addEventListener('hashchange', function () { var p = page(); if (p !== lastPage) { lastPage = p; track('view'); } });

  var pending = false;
  window.AtomusSite = {
    vid: VID, sid: SID, key: KEY, api: API,
    click: function (label) { return track('click', { label: String(label || '').slice(0, 120) }); },
    lead: function (data) {
      if (!KEY) return Promise.resolve({ ok: false, message: 'Сайт не подключён к CRM' });
      if (pending) return Promise.resolve({ ok: false, message: 'Отправляем заявку…' });
      data = data || {};
      // ключ идемпотентности живёт в форме: повтор после сбоя — та же заявка, не дубль
      if (!data.lead_key) { try { data.lead_key = sessionStorage.getItem('atomus_lead_key') || rid(); sessionStorage.setItem('atomus_lead_key', data.lead_key); } catch (e) { data.lead_key = rid(); } }
      data.sid = SID; data.page = data.page || page();
      pending = true;
      return fetch(base + '/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), mode: 'cors' })
        .then(function (r) { return r.json().then(function (j) { j.status = r.status; return j; }); })
        .then(function (j) { pending = false; if (j && j.ok) { try { sessionStorage.removeItem('atomus_lead_key'); } catch (e) {} } return j; })
        .catch(function () { pending = false; return { ok: false, message: 'Не удалось отправить заявку. Данные сохранены в форме. Попробуйте ещё раз или позвоните нам' }; });
    }
  };
})();
