# -*- coding: utf-8 -*-
"""Собирает самодостаточный стенд композера «Клавы» из ЖИВЫХ стилей app.css.

Нужен, чтобы показать правку в ленте CRM панелью-макетом, не подключая
мегабайтный app.css и не требуя авторизации. Берём только те блоки, что
относятся к композеру, — если стили поедут, поедет и стенд.

    python tools/build_composer_demo.py <куда_положить.html>
"""
import io
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Диапазоны строк app.css (1-based, включительно), из которых живёт композер
RANGES = [
    (23548, 23594),   # база: box / input-row / attach / send / hint / вложения
    (23682, 23685),   # v2.45.947 — лоск
    (23756, 23767),   # чипы
    (23896, 23901),   # композер: чипы прячутся, размер стрелки
    (24012, 24022),   # микрофон и подмена на стрелку
    (24035, 24035),   # keyframes dchatSlideUp
]


def main(out_path):
    css_lines = io.open(os.path.join(ROOT, 'app.css'), encoding='utf-8').read().split('\n')
    parts = []
    for a, b in RANGES:
        parts.append('\n'.join(css_lines[a - 1:b]))
    # новый блок — от баннера v2.45.971 до конца файла
    for i, line in enumerate(css_lines):
        if 'v2.45.971' in line and 'ровный композер' in line:
            parts.append('\n'.join(css_lines[i:]))
            break
    live_css = '\n\n'.join(parts)

    html = TEMPLATE.replace('/*LIVE_CSS*/', live_css)
    io.open(out_path, 'w', encoding='utf-8').write(html)
    print('готово:', out_path, len(html), 'байт')


TEMPLATE = u"""<!DOCTYPE html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Композер «Клавы» — как стало (v2.45.971)</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.47.0/tabler-icons.min.css">
<style>
  :root{
    --brand:#2D5F8B; --brand-light:#4A7FB5; --bg:#F4F7FB; --surface:#fff;
    --border:#E2E8F0; --border-strong:#DDE5F0;
    --text-dark:#1E293B; --text-mid:#43536b; --text-light:#64748B; --text-faint:#94A3B8;
    --danger:#DC2626; --danger-bg:#FEE2E2; --success:#16A34A;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#EEF2F7;color:var(--text-dark);}
  .wrap{max-width:520px;margin:0 auto;padding:16px 14px 30px;}
  h1{font-size:17px;margin:0 0 4px;}
  .sub{font-size:12.5px;color:var(--text-light);margin-bottom:14px;line-height:1.5;}
  .phone{background:var(--bg);border:1px solid var(--border);border-radius:20px;padding:12px 12px 10px;
         box-shadow:0 10px 30px rgba(15,30,60,.10);}
  .feed{height:150px;border-radius:14px;background:radial-gradient(900px 300px at 50% -6%,rgba(139,123,240,.09),transparent) #F4F7FB;
        display:flex;align-items:flex-end;padding:10px;font-size:12.5px;color:var(--text-light);}
  .note{font-size:12px;color:var(--text-light);margin-top:14px;line-height:1.6;}
  .note b{color:var(--text-dark)}
  .app{display:block}
  /* ===== живые стили композера из app.css ===== */
/*LIVE_CSS*/
</style></head>
<body>
<div class="wrap">
  <h1>Композер «Клавы» — как стало</h1>
  <div class="sub">Стили взяты из <b>app.css</b> ветки правки. Попробуйте: напечатайте текст (микрофон станет стрелкой, чипы уедут), пролистайте чипы вправо, нажмите «+».</div>

  <div class="app mobile-layout phone">
    <div class="feed">лента переписки…</div>

    <div class="dchat-composer" style="padding-top:10px">
      <div class="dchat-chips" id="chips" onscroll="fade()">
        <button><i class="ti ti-progress"></i>Что сейчас в работе?</button>
        <button><i class="ti ti-file-search"></i>Проверь логи за сегодня</button>
        <button><i class="ti ti-brush"></i>Поправь дизайн раздела…</button>
      </div>
      <div class="dchat-box">
        <div class="dchat-input-row" id="row">
          <button class="dchat-attach" onclick="openSheet()" title="Прикрепить"><i class="ti ti-plus"></i></button>
          <textarea id="inp" class="dchat-input" rows="1" placeholder="Задача для Клавы…" oninput="grow(this)"></textarea>
          <button class="dchat-mic"><i class="ti ti-microphone"></i></button>
          <button class="dchat-send"><i class="ti ti-arrow-up"></i></button>
        </div>
      </div>
    </div>
  </div>

  <div class="note">
    <b>Что изменилось.</b> Слева «+» вместо камеры и скрепки — 40×40, тот же радиус и отступ, что у микрофона.
    Камера, галерея и файл — в шторке под «+». Чип «Снять фото» убран.
    Микрофон и стрелка — один силуэт, кнопка не меняет форму. У правого края чипов — растушёвка.
    На телефоне убраны подпись «Enter — отправить» и круглый «+» таб-бара.
  </div>
</div>

<div class="dchat-sheet" id="sheet">
  <div class="dcs-card">
    <button class="dcs-it" onclick="closeSheet()"><i class="ti ti-camera"></i><span>Снять фото</span></button>
    <button class="dcs-it" onclick="closeSheet()"><i class="ti ti-photo"></i><span>Галерея</span></button>
    <button class="dcs-it" onclick="closeSheet()"><i class="ti ti-paperclip"></i><span>Файл</span></button>
    <button class="dcs-cancel" onclick="closeSheet()">Отмена</button>
  </div>
</div>

<script>
function grow(el){
  el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,168)+'px';
  var t=!!(el.value||'').trim();
  document.getElementById('chips').classList.toggle('is-hidden',t);
  document.getElementById('row').classList.toggle('has-text',t);
  fade();
}
function fade(){
  var c=document.getElementById('chips');
  c.classList.toggle('has-more', c.scrollWidth-c.clientWidth-c.scrollLeft>8);
}
function openSheet(){ document.getElementById('sheet').classList.add('show'); }
function closeSheet(){ document.getElementById('sheet').classList.remove('show'); }
document.getElementById('sheet').addEventListener('click',function(e){ if(e.target===this) closeSheet(); });
fade(); window.addEventListener('resize',fade);
</script>
</body></html>
"""


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'composer-demo.html'))
