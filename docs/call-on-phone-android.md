# Android Chrome: tel: from Web Push / Service Worker

## Finding (2026-10-08)

`clients.openWindow('tel:+7…')` from a service worker `notificationclick` handler
**does not open the dialer on Android Chrome**. Chrome treats it as a normal URL and
shows a blank/black tab with the `tel:` string (known limitation; same for `mailto:`).

Notification action buttons with a `tel:` URL have the same problem.

## Chosen path (v2.46.254)

1. Push payload includes `url: /#prospects/<id>?dial=<phone>`, `prospectId`, `phone`, `kind: call-on-phone`.
2. `notificationclick` focuses an existing PWA client (or `openWindow` that CRM URL) and `postMessage({type:'atomus-call-dial', …})`.
3. The app shows a full-screen **«Позвонить &lt;номер&gt;»** button (`tel:` link — real user gesture) and arms the existing «Как прошёл звонок?» sheet via `visibilitychange`.
4. Auto `a.click()` is attempted (may work when the click is still in the notification user-gesture chain); if blocked, the big button remains.

## Phone setup for Dmitriy

1. Chrome on Android (with Google Play services — not HMS-only).
2. Open `https://crm.atomuscrm.ru` → Add to Home screen (install PWA).
3. Open the installed icon (standalone), log in.
4. Allow notifications when asked.
5. **Аккаунт → «Сделать этот телефон рабочим для звонков»** → confirm test push.
6. On PC, card shows **«На рабочий телефон»**; tap sends the push.
