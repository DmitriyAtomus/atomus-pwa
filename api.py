"""REST API модуля Atomus для PWA-клиента.

Использует aiohttp — асинхронный HTTP-сервер, дружащий с asyncio (на котором работает бот).
Запускается параллельно с Telegram-polling в одном процессе на Railway.

Авторизация: Telegram Login Widget.
Клиент (PWA) логинится через Telegram → получает данные (id, name, hash) →
шлёт их нам в POST /api/auth/telegram → мы проверяем подпись через bot_token,
выдаём session-токен (JWT-подобный, но проще). Все остальные запросы — с этим токеном.

Endpoints (v1, только чтение):
- POST /api/auth/telegram   — логин через Telegram Login Widget
- GET  /api/me               — текущий пользователь (роли, имя)
- GET  /api/dashboard        — KPI + последние записи
- GET  /api/history          — список сборок с фильтрами
- GET  /api/summary          — сводки за период (срезы)
- GET  /api/employees        — список сотрудников
- GET  /api/models           — справочник моделей
- GET  /api/health           — проверка живости

CORS открыт для домена Vercel-deploy и localhost (для разработки).
"""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from datetime import date, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

from aiohttp import web

from . import db
from . import reports
from .config import (
    OWNER_CHAT_ID,
    ROLE_DIRECTOR, ROLE_ACCOUNTANT, ROLE_MASTER,
    ROLE_ZAM, ROLE_MANAGER, ROLE_ENGINEER,
    ALL_ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS,
    LEGAL_ENTITIES, get_legal_entity, DEFAULT_LEGAL_ENTITY,
    CONTRACT_STATUSES, CONTRACT_STATUS_LABELS,
    CONTRACT_STATUS_PRODUCTION,
    CONTRACT_TYPES, CONTRACT_TYPE_LABELS, CONTRACT_TYPE_SUPPLY,
    CONTRACTOR_TYPES, CONTRACTOR_TYPE_LABELS, CONTRACTOR_TYPE_LEGAL,
    SALE_PRODUCT_TYPES, SALE_PRODUCT_TYPE_LABELS,
    SALE_PRODUCT_TYPE_GOODS, SALE_PRODUCT_UNITS,
    OFFER_STATUSES, OFFER_STATUS_LABELS,
    OFFER_STATUS_DRAFT,
    get_user_roles, can_manage_sales, can_view_sales,
    has_any_role,
)

logger = logging.getLogger("atomus.api")

# ============ КОНФИГУРАЦИЯ ============

# Bot token нужен для проверки подписи Telegram Login
BOT_TOKEN = os.environ.get("BOT_TOKEN", "") or os.environ.get("TELEGRAM_BOT_TOKEN", "")

# Секрет для подписи session-токенов. Если не задан — генерим случайный при старте.
# При перезагрузке бота все сессии инвалидируются — это OK, пользователь перелогинится.
SESSION_SECRET = os.environ.get("ATOMUS_SESSION_SECRET", "") or secrets.token_hex(32)

# Время жизни сессии — 30 дней
SESSION_TTL_SECONDS = 30 * 24 * 3600

# Разрешённые origins для CORS.
# В первой версии — открыто для всех (PWA на Vercel постоянно меняет URL preview-деплоев).
# Можно ужесточить позже когда домен atomus.online будет настроен.
ALLOWED_ORIGINS = "*"

# ============ ОДНОРАЗОВЫЕ КОДЫ ДЛЯ ЛОГИНА ============

# Хранилище кодов: {code: {"chat_id": ..., "expires": ...}}
# Хранится в памяти процесса — при перезапуске бота все коды сбрасываются.
# Это нормально: коды живут 5 минут, перезапуски редкие.
_login_codes: dict[str, dict] = {}
LOGIN_CODE_TTL_SECONDS = 5 * 60  # 5 минут


def create_login_code(chat_id: int) -> str:
    """Создаёт 6-значный одноразовый код для входа в PWA.

    Вызывается из бота при команде /login.
    Удаляет старые коды этого chat_id (если повторно запросил — старый код инвалидируется).
    """
    # Удаляем старые коды этого пользователя
    to_remove = [
        c for c, info in _login_codes.items()
        if info.get("chat_id") == chat_id
    ]
    for c in to_remove:
        del _login_codes[c]

    # Чистим истёкшие коды (на всякий случай — мусор не копится)
    now = time.time()
    expired = [c for c, info in _login_codes.items() if info.get("expires", 0) < now]
    for c in expired:
        del _login_codes[c]

    # Генерируем новый код
    code = f"{secrets.randbelow(1000000):06d}"  # 000000-999999
    _login_codes[code] = {
        "chat_id": chat_id,
        "expires": now + LOGIN_CODE_TTL_SECONDS,
    }
    logger.info("Atomus API: создан login-код для chat_id=%d", chat_id)
    return code


def verify_login_code(code: str) -> int | None:
    """Проверяет код. Если валидный — возвращает chat_id и УДАЛЯЕТ код (одноразовый).
    Если невалидный/истёкший — None.
    """
    info = _login_codes.get(code)
    if not info:
        return None
    if info.get("expires", 0) < time.time():
        del _login_codes[code]
        return None
    chat_id = info["chat_id"]
    # Одноразовый — удаляем после использования
    del _login_codes[code]
    return chat_id


# ============ АВТОРИЗАЦИЯ ============


def _verify_telegram_auth(data: dict) -> bool:
    """Проверяет подпись данных от Telegram Login Widget.

    Алгоритм (документация https://core.telegram.org/widgets/login):
    1. Все поля кроме `hash` сортируются и собираются в строку 'key=val\nkey=val\n...'
    2. secret_key = SHA256(bot_token)
    3. HMAC-SHA256 строки с secret_key должен совпасть с hash в данных
    """
    if not BOT_TOKEN:
        logger.error("Atomus API: BOT_TOKEN не задан, проверка авторизации невозможна")
        return False

    received_hash = data.get("hash")
    if not received_hash:
        return False

    # Собираем строку проверки
    data_check = "\n".join(
        f"{k}={data[k]}"
        for k in sorted(data.keys())
        if k != "hash"
    )
    secret_key = hashlib.sha256(BOT_TOKEN.encode()).digest()
    expected_hash = hmac.new(
        secret_key, data_check.encode(), hashlib.sha256,
    ).hexdigest()

    # Сравниваем безопасно (без timing-атаки)
    if not hmac.compare_digest(expected_hash, received_hash):
        return False

    # Проверка свежести (не старше 24 часов)
    auth_date = int(data.get("auth_date", 0))
    if time.time() - auth_date > 86400:
        return False

    return True


def _create_session_token(chat_id: int) -> str:
    """Создаёт session-токен. Простой формат: 'chat_id.expires.signature'."""
    expires = int(time.time()) + SESSION_TTL_SECONDS
    payload = f"{chat_id}.{expires}"
    sig = hmac.new(
        SESSION_SECRET.encode(), payload.encode(), hashlib.sha256,
    ).hexdigest()
    return f"{payload}.{sig}"


def _verify_session_token(token: str) -> int | None:
    """Проверяет session-токен. Возвращает chat_id или None."""
    if not token:
        return None
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        chat_id_str, expires_str, sig = parts
        chat_id = int(chat_id_str)
        expires = int(expires_str)
        # Проверка подписи
        payload = f"{chat_id}.{expires}"
        expected_sig = hmac.new(
            SESSION_SECRET.encode(), payload.encode(), hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected_sig, sig):
            return None
        # Проверка свежести
        if time.time() > expires:
            return None
        return chat_id
    except (ValueError, TypeError):
        return None


def _get_chat_id_from_request(request: web.Request) -> int | None:
    """Достаёт chat_id из заголовка Authorization: Bearer <token>."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[len("Bearer "):]
    return _verify_session_token(token)


# ============ MIDDLEWARE ============


@web.middleware
async def cors_middleware(request: web.Request, handler):
    """Добавляет CORS-заголовки на все ответы + обрабатывает preflight (OPTIONS)."""
    if request.method == "OPTIONS":
        return web.Response(
            status=204,
            headers={
                "Access-Control-Allow-Origin": ALLOWED_ORIGINS,
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Access-Control-Max-Age": "86400",
            },
        )
    try:
        response = await handler(request)
    except web.HTTPException as e:
        e.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGINS
        raise
    response.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGINS
    return response


@web.middleware
async def error_middleware(request: web.Request, handler):
    """Конвертирует ошибки в JSON-ответы."""
    try:
        return await handler(request)
    except web.HTTPException:
        raise
    except Exception as e:
        logger.exception("Atomus API: необработанная ошибка")
        return web.json_response(
            {"error": "internal_error", "message": str(e)},
            status=500,
        )


def require_auth(handler):
    """Декоратор: эндпоинт требует валидный токен."""
    async def wrapper(request: web.Request):
        chat_id = _get_chat_id_from_request(request)
        if chat_id is None:
            return web.json_response(
                {"error": "unauthorized", "message": "Требуется вход через Telegram"},
                status=401,
            )
        # Проверяем что у пользователя ещё есть роль (могли снять)
        if not get_user_roles(chat_id):
            return web.json_response(
                {"error": "forbidden", "message": "Доступ к Atomus отозван"},
                status=403,
            )
        request["chat_id"] = chat_id
        return await handler(request)
    return wrapper


def require_director(handler):
    """Декоратор: эндпоинт только для директора."""
    async def wrapper(request: web.Request):
        chat_id = _get_chat_id_from_request(request)
        if chat_id is None:
            return web.json_response(
                {"error": "unauthorized"},
                status=401,
            )
        roles = get_user_roles(chat_id)
        if ROLE_DIRECTOR not in roles:
            return web.json_response(
                {"error": "forbidden", "message": "Доступно только директору"},
                status=403,
            )
        request["chat_id"] = chat_id
        return await handler(request)
    return wrapper


def require_master_or_director(handler):
    """Декоратор: эндпоинт для мастера или директора (внесение сборок)."""
    async def wrapper(request: web.Request):
        chat_id = _get_chat_id_from_request(request)
        if chat_id is None:
            return web.json_response(
                {"error": "unauthorized"},
                status=401,
            )
        roles = get_user_roles(chat_id)
        if not (ROLE_MASTER in roles or ROLE_DIRECTOR in roles):
            return web.json_response(
                {"error": "forbidden",
                 "message": "Доступно только мастерам и директору"},
                status=403,
            )
        request["chat_id"] = chat_id
        return await handler(request)
    return wrapper


def require_sales_manage(handler):
    """Декоратор: эндпоинт для тех кто может работать в Продажах.

    Это: директор, зам, менеджер.
    """
    async def wrapper(request: web.Request):
        chat_id = _get_chat_id_from_request(request)
        if chat_id is None:
            return web.json_response(
                {"error": "unauthorized"},
                status=401,
            )
        if not can_manage_sales(chat_id):
            return web.json_response(
                {"error": "forbidden",
                 "message": "Управление продажами доступно директору, заму, менеджеру"},
                status=403,
            )
        request["chat_id"] = chat_id
        return await handler(request)
    return wrapper


def require_sales_view(handler):
    """Декоратор: эндпоинт для просмотра данных Продаж (любой авторизованный)."""
    async def wrapper(request: web.Request):
        chat_id = _get_chat_id_from_request(request)
        if chat_id is None:
            return web.json_response(
                {"error": "unauthorized"},
                status=401,
            )
        if not can_view_sales(chat_id):
            return web.json_response(
                {"error": "forbidden", "message": "Доступ запрещён"},
                status=403,
            )
        request["chat_id"] = chat_id
        return await handler(request)
    return wrapper


# ============ ENDPOINTS ============


async def health(request: web.Request) -> web.Response:
    """Проверка живости (для мониторинга Railway)."""
    return web.json_response({
        "status": "ok",
        "service": "atomus-api",
        "time": datetime.now().isoformat(),
    })


async def root(request: web.Request) -> web.Response:
    """Простая страничка по корню — чтобы люди понимали что попали в API."""
    return web.Response(
        text=(
            "Atomus API · работает\n\n"
            "Это REST-API сервиса производственного учёта Atomus.\n"
            "Для использования нужен клиент (PWA atomus.app или Telegram-бот).\n\n"
            "Эндпоинты:\n"
            "  GET  /api/health\n"
            "  POST /api/auth/telegram\n"
            "  POST /api/auth/code\n"
            "  GET  /api/me\n"
            "  GET  /api/dashboard\n"
            "  GET  /api/history\n"
            "  GET  /api/summary\n"
            "  GET  /api/employees\n"
            "  GET  /api/employees/active\n"
            "  GET  /api/models\n"
            "  POST /api/assemblies\n"
        ),
        content_type="text/plain",
    )


async def auth_telegram(request: web.Request) -> web.Response:
    """Логин через Telegram Login Widget.

    Тело запроса (POST): JSON с полями от Telegram:
        {
          "id": 648887249,
          "first_name": "Дмитрий",
          "username": "...",
          "auth_date": 1715500000,
          "hash": "abc..."
        }

    Ответ:
        { "token": "...", "user": { "chat_id": ..., "name": ..., "roles": [...] } }
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response(
            {"error": "bad_request", "message": "Тело должно быть JSON"},
            status=400,
        )

    if not isinstance(data, dict):
        return web.json_response(
            {"error": "bad_request"},
            status=400,
        )

    # Конвертируем все значения в строки (Telegram присылает числа как числа,
    # но для проверки подписи нужны строки)
    data_str = {k: str(v) for k, v in data.items()}

    if not _verify_telegram_auth(data_str):
        return web.json_response(
            {"error": "invalid_auth",
             "message": "Подпись Telegram не подтверждена"},
            status=403,
        )

    chat_id = int(data["id"])
    roles = get_user_roles(chat_id)
    if not roles:
        return web.json_response(
            {"error": "no_access",
             "message": "У вас нет доступа к Atomus. Обратитесь к директору."},
            status=403,
        )

    # Создаём session-токен
    token = _create_session_token(chat_id)

    # Имя — из БД (если есть) или из Telegram
    emp = await db.get_employee_by_telegram_id(chat_id)
    if emp:
        full_name = emp.get("full_name") or ""
        short_name = emp.get("short_name") or ""
        position = emp.get("position") or ""
        emp_id = emp.get("id")
        # Поле name — для обратной совместимости со старым фронтом
        name = short_name or full_name or data.get("first_name", "")
    else:
        # Только владелец может зайти без записи в БД
        tg_name = data.get("first_name", "")
        if data.get("last_name"):
            tg_name = f"{tg_name} {data['last_name']}"
        full_name = tg_name or "Владелец"
        short_name = full_name
        position = ""
        emp_id = None
        name = full_name

    return web.json_response({
        "token": token,
        "user": {
            "chat_id": chat_id,
            "id": emp_id,
            "name": name,            # обратная совместимость
            "full_name": full_name,
            "short_name": short_name,
            "position": position,
            "roles": sorted(roles),
        },
    })


async def auth_code(request: web.Request) -> web.Response:
    """Логин по одноразовому 6-значному коду.

    Пользователь пишет боту /login, бот присылает код в чат, юзер вводит на PWA.

    Тело запроса (POST):
        { "code": "427593" }

    Ответ:
        { "token": "...", "user": { "chat_id": ..., "name": ..., "roles": [...] } }
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response(
            {"error": "bad_request", "message": "Тело должно быть JSON"},
            status=400,
        )

    code = str(data.get("code", "")).strip()
    if not code or not code.isdigit() or len(code) != 6:
        return web.json_response(
            {"error": "bad_code",
             "message": "Код должен быть 6 цифр"},
            status=400,
        )

    chat_id = verify_login_code(code)
    if chat_id is None:
        return web.json_response(
            {"error": "invalid_code",
             "message": "Код неверный или истёк. Запросите новый: напишите боту /login"},
            status=403,
        )

    roles = get_user_roles(chat_id)
    if not roles:
        return web.json_response(
            {"error": "no_access",
             "message": "У вас нет доступа к Atomus."},
            status=403,
        )

    token = _create_session_token(chat_id)

    emp = await db.get_employee_by_telegram_id(chat_id)
    if emp:
        full_name = emp.get("full_name") or ""
        short_name = emp.get("short_name") or ""
        position = emp.get("position") or ""
        emp_id = emp.get("id")
        name = short_name or full_name or ""
    else:
        full_name = "Владелец"
        short_name = "Владелец"
        position = ""
        emp_id = None
        name = "Владелец"

    return web.json_response({
        "token": token,
        "user": {
            "chat_id": chat_id,
            "id": emp_id,
            "name": name,            # обратная совместимость
            "full_name": full_name,
            "short_name": short_name,
            "position": position,
            "roles": sorted(roles),
        },
    })


@require_auth
async def get_me(request: web.Request) -> web.Response:
    """Информация о текущем пользователе."""
    chat_id = request["chat_id"]
    roles = get_user_roles(chat_id)

    emp = await db.get_employee_by_telegram_id(chat_id)
    if emp:
        info = {
            "chat_id": chat_id,
            "id": emp["id"],
            "full_name": emp.get("full_name") or "",
            "short_name": emp.get("short_name") or "",
            "position": emp.get("position") or "",
            "roles": sorted(roles),
        }
    else:
        info = {
            "chat_id": chat_id,
            "id": None,
            "full_name": "Владелец",
            "short_name": "Владелец",
            "position": "",
            "roles": sorted(roles),
        }
    return web.json_response(info)


@require_auth
async def get_dashboard(request: web.Request) -> web.Response:
    """KPI для главного экрана + последние записи."""
    today = date.today()
    today_iso = today.isoformat()
    week_ago = (today - timedelta(days=6)).isoformat()
    month_ago = (today - timedelta(days=29)).isoformat()

    # Сводки
    today_total = await reports.summary_total(today_iso, today_iso)
    week_total = await reports.summary_total(week_ago, today_iso)
    month_total = await reports.summary_total(month_ago, today_iso)

    # Сравнение с прошлой неделей/месяцем для трендов
    prev_week_from = (today - timedelta(days=13)).isoformat()
    prev_week_to = (today - timedelta(days=7)).isoformat()
    prev_week_total = await reports.summary_total(prev_week_from, prev_week_to)

    prev_month_from = (today - timedelta(days=59)).isoformat()
    prev_month_to = (today - timedelta(days=30)).isoformat()
    prev_month_total = await reports.summary_total(prev_month_from, prev_month_to)

    # Топ сборщиков за неделю
    by_emp_week = await reports.summary_by_employee(week_ago, today_iso)

    # Последние записи (5 штук за месяц)
    recent_raw = await db.get_assemblies_by_period(month_ago, today_iso)
    # Группируем по assembly_id
    grouped: dict[int, dict] = {}
    for r in recent_raw:
        aid = r["assembly_id"]
        if aid not in grouped:
            grouped[aid] = {
                "id": aid,
                "date": r["date"],
                "model_name": r["model_name"],
                "model_extra": r.get("model_extra"),
                "article": r["article"],
                "direction": r.get("direction_name"),
                "direction_code": r.get("direction_code"),
                "qty": r["qty"],
                "execution": _exec_label(r),
                "ip_class": r.get("ip_class"),
                "comment": r.get("comment"),
                "workers": [],
            }
        worker_name = r.get("employee_short_name") or r.get("employee_full_name")
        if worker_name and worker_name not in grouped[aid]["workers"]:
            grouped[aid]["workers"].append(worker_name)
    recent_records = sorted(
        grouped.values(),
        key=lambda x: x["date"],
        reverse=True,
    )[:8]

    # Динамика за 14 дней (для мини-графика)
    fourteen_ago = (today - timedelta(days=13)).isoformat()
    daily = await db._fetch_all(
        """SELECT assembly_date, SUM(quantity) as qty
           FROM assemblies
           WHERE is_active = 1 AND assembly_date BETWEEN ? AND ?
           GROUP BY assembly_date
           ORDER BY assembly_date""",
        (fourteen_ago, today_iso),
    )
    by_date = {r["assembly_date"]: r["qty"] or 0 for r in daily}
    daily_series = []
    cur = today - timedelta(days=13)
    while cur <= today:
        iso = cur.isoformat()
        daily_series.append({"date": iso, "qty": by_date.get(iso, 0)})
        cur += timedelta(days=1)

    return web.json_response({
        "today": {
            "qty": today_total["total_qty"],
            "records": today_total["total_records"],
        },
        "week": {
            "qty": week_total["total_qty"],
            "records": week_total["total_records"],
            "trend_pct": _trend_pct(week_total["total_qty"], prev_week_total["total_qty"]),
        },
        "month": {
            "qty": month_total["total_qty"],
            "records": month_total["total_records"],
            "models": month_total["unique_models"],
            "employees": month_total["unique_employees"],
            "trend_pct": _trend_pct(month_total["total_qty"], prev_month_total["total_qty"]),
        },
        "top_employees": [
            {
                "name": r.get("short_name") or r.get("full_name"),
                "qty": r["qty"],
            }
            for r in by_emp_week[:5]
        ],
        "recent": recent_records,
        "daily_14d": daily_series,
    })


@require_auth
async def get_history(request: web.Request) -> web.Response:
    """История сборок с фильтрами.

    Query params:
        from=YYYY-MM-DD (default: 30 дней назад)
        to=YYYY-MM-DD (default: сегодня)
        direction_id=N (опционально)
        employee_id=N (опционально)
        limit=N (default 100)
    """
    chat_id = request["chat_id"]
    roles = get_user_roles(chat_id)

    today = date.today()
    date_from = request.query.get("from") or (today - timedelta(days=29)).isoformat()
    date_to = request.query.get("to") or today.isoformat()
    direction_id = request.query.get("direction_id")
    employee_id = request.query.get("employee_id")
    limit = int(request.query.get("limit", "100"))

    if not _is_valid_date(date_from) or not _is_valid_date(date_to):
        return web.json_response(
            {"error": "bad_request", "message": "Неверный формат даты"},
            status=400,
        )

    raw = await db.get_assemblies_by_period(
        date_from, date_to,
        direction_id=int(direction_id) if direction_id else None,
        employee_id=int(employee_id) if employee_id else None,
    )

    # Группируем по assembly_id
    grouped: dict[int, dict] = {}
    for r in raw:
        aid = r["assembly_id"]
        if aid not in grouped:
            grouped[aid] = {
                "id": aid,
                "date": r["date"],
                "model_name": r["model_name"],
                "model_extra": r.get("model_extra"),
                "article": r["article"],
                "direction": r.get("direction_name"),
                "direction_code": r.get("direction_code"),
                "category": r.get("category_name"),
                "subgroup": r.get("subgroup_name"),
                "qty": r["qty"],
                "execution": _exec_label(r),
                "ip_class": r.get("ip_class"),
                "comment": r.get("comment"),
                "contract_id": r.get("contract_id"),
                "contract_number": r.get("contract_number") or "",
                "contract_contractor_name": r.get("contract_contractor_name") or "",
                "workers": [],
            }
        worker_name = r.get("employee_short_name") or r.get("employee_full_name")
        if worker_name and worker_name not in grouped[aid]["workers"]:
            grouped[aid]["workers"].append(worker_name)

    records = sorted(grouped.values(), key=lambda x: (x["date"], x["id"]), reverse=True)[:limit]

    return web.json_response({
        "from": date_from,
        "to": date_to,
        "total_records": len(records),
        "records": records,
    })


@require_auth
async def get_summary(request: web.Request) -> web.Response:
    """Сводки за период + срезы.

    Query params:
        period=day|week|month|prev_month (default: month)
        — или явно from/to
    """
    period = request.query.get("period")
    if period:
        date_from, date_to, period_label = reports.get_period_range(period)
    else:
        today = date.today()
        date_from = request.query.get("from") or (today - timedelta(days=29)).isoformat()
        date_to = request.query.get("to") or today.isoformat()
        period_label = f"{date_from} — {date_to}"
        if not _is_valid_date(date_from) or not _is_valid_date(date_to):
            return web.json_response(
                {"error": "bad_request"},
                status=400,
            )

    total = await reports.summary_total(date_from, date_to)
    by_model = await reports.summary_by_model(date_from, date_to)
    by_emp = await reports.summary_by_employee(date_from, date_to)
    by_dir = await reports.summary_by_direction(date_from, date_to)

    # Дневная разбивка
    daily = await db._fetch_all(
        """SELECT assembly_date, SUM(quantity) as qty
           FROM assemblies
           WHERE is_active = 1 AND assembly_date BETWEEN ? AND ?
           GROUP BY assembly_date
           ORDER BY assembly_date""",
        (date_from, date_to),
    )
    by_date = {r["assembly_date"]: r["qty"] or 0 for r in daily}
    daily_series = []
    df_d = datetime.strptime(date_from, "%Y-%m-%d").date()
    dt_d = datetime.strptime(date_to, "%Y-%m-%d").date()
    cur = df_d
    while cur <= dt_d:
        iso = cur.isoformat()
        daily_series.append({"date": iso, "qty": by_date.get(iso, 0)})
        cur += timedelta(days=1)

    return web.json_response({
        "from": date_from,
        "to": date_to,
        "period_label": period_label,
        "total": total,
        "by_model": [
            {
                "model_name": r["model_name"],
                "model_extra": r.get("model_extra"),
                "article": r.get("article"),
                "direction": r.get("direction_name"),
                "qty": r["qty"],
            }
            for r in by_model
        ],
        "by_employee": [
            {
                "id": r.get("id"),
                "full_name": r.get("full_name"),
                "short_name": r.get("short_name"),
                "qty": r["qty"],
            }
            for r in by_emp
        ],
        "by_direction": [
            {
                "direction": r["direction_name"],
                "qty": r["qty"],
            }
            for r in by_dir
        ],
        "daily": daily_series,
    })


@require_director
async def get_employees(request: web.Request) -> web.Response:
    """Список сотрудников. Только для директора (содержит Telegram ID, телефоны и т.д.)."""
    include_inactive = request.query.get("include_inactive", "false").lower() == "true"
    employees = await db.get_all_employees(include_inactive=include_inactive)
    # Чистим — не отдаём чувствительное наружу
    result = []
    for e in employees:
        roles_str = e.get("roles") or ""
        roles = sorted({r.strip() for r in roles_str.split(",") if r.strip()})
        result.append({
            "id": e["id"],
            "full_name": e.get("full_name"),
            "short_name": e.get("short_name"),
            "position": e.get("position") or "",
            "phone": e.get("phone") or "",
            "email": e.get("email") or "",
            "tab_number": e.get("tab_number") or "",
            "telegram_id": e.get("telegram_id"),
            "is_active": bool(e.get("is_active")),
            "roles": roles,
        })
    return web.json_response({"employees": result})


@require_auth
async def get_employees_active(request: web.Request) -> web.Response:
    """Упрощённый список активных сотрудников — для выбора сборщиков при внесении.

    Доступен мастеру и директору (по @require_auth, без расширенной фильтрации,
    но без чувствительных полей). Возвращает только id, short_name, full_name, роли.
    """
    employees = await db.get_all_employees(include_inactive=False)
    result = []
    for e in employees:
        roles_str = e.get("roles") or ""
        roles = sorted({r.strip() for r in roles_str.split(",") if r.strip()})
        result.append({
            "id": e["id"],
            "full_name": e.get("full_name") or "",
            "short_name": e.get("short_name") or "",
            "roles": roles,
            "is_master": "master" in roles,
        })
    return web.json_response({"employees": result})


@require_master_or_director
async def create_assembly(request: web.Request) -> web.Response:
    """Создаёт сборку через PWA.

    Тело (JSON):
        {
          "model_id": 12,
          "quantity": 3,
          "assembly_date": "2026-05-12",   // YYYY-MM-DD, не будущая, не старше года
          "worker_ids": [4, 7],            // ID активных сотрудников
          "execution": "st" | "ne" | null, // обязательно если model.exec_mode == "choice"
          "ip_class": "IP54" | "IP55" | "IP65" | null,  // если model.needs_ip
          "comment": ""                     // опционально
        }
    Ответ при успехе: { "id": 123, "ok": true }
    Ответ при ошибке: { "error": "...", "message": "..." } со статусом 400/403/422
    """
    chat_id = request["chat_id"]
    try:
        data = await request.json()
    except Exception:
        return web.json_response(
            {"error": "bad_request", "message": "Тело должно быть JSON"},
            status=400,
        )

    if not isinstance(data, dict):
        return web.json_response(
            {"error": "bad_request"},
            status=400,
        )

    # --- Извлечение полей ---
    try:
        model_id = int(data.get("model_id"))
    except (TypeError, ValueError):
        return web.json_response(
            {"error": "bad_request", "message": "Нужно поле model_id"},
            status=400,
        )

    try:
        quantity = int(data.get("quantity"))
    except (TypeError, ValueError):
        return web.json_response(
            {"error": "bad_request", "message": "Нужно поле quantity"},
            status=400,
        )

    if quantity < 1 or quantity > 1000:
        return web.json_response(
            {"error": "bad_quantity",
             "message": "Количество должно быть от 1 до 1000"},
            status=422,
        )

    assembly_date = str(data.get("assembly_date") or "").strip()
    if not _is_valid_date(assembly_date):
        return web.json_response(
            {"error": "bad_date",
             "message": "Неверный формат даты, нужен YYYY-MM-DD"},
            status=400,
        )

    # Дата не в будущем и не старше года
    try:
        d_iso = datetime.strptime(assembly_date, "%Y-%m-%d").date()
    except ValueError:
        return web.json_response({"error": "bad_date"}, status=400)
    today = date.today()
    if d_iso > today:
        return web.json_response(
            {"error": "future_date",
             "message": "Дата не может быть в будущем"},
            status=422,
        )
    if (today - d_iso).days > 365:
        return web.json_response(
            {"error": "old_date",
             "message": "Дата слишком старая (больше года назад)"},
            status=422,
        )

    worker_ids_raw = data.get("worker_ids") or []
    if not isinstance(worker_ids_raw, list) or not worker_ids_raw:
        return web.json_response(
            {"error": "no_workers",
             "message": "Укажите хотя бы одного сборщика"},
            status=422,
        )
    try:
        worker_ids = [int(w) for w in worker_ids_raw]
    except (TypeError, ValueError):
        return web.json_response(
            {"error": "bad_workers", "message": "worker_ids должен быть списком чисел"},
            status=400,
        )

    execution = data.get("execution")
    if execution is not None:
        execution = str(execution).strip().lower()
        if execution not in ("st", "ne"):
            return web.json_response(
                {"error": "bad_execution",
                 "message": "execution может быть 'st' или 'ne'"},
                status=400,
            )
    ip_class = data.get("ip_class")
    if ip_class is not None:
        ip_class = str(ip_class).strip().upper()
        if ip_class not in ("IP54", "IP55", "IP65"):
            return web.json_response(
                {"error": "bad_ip_class",
                 "message": "ip_class может быть 'IP54', 'IP55' или 'IP65'"},
                status=400,
            )
    comment = str(data.get("comment") or "").strip()[:500]

    # --- Проверка модели ---
    model = await db.get_model_by_id(model_id)
    if not model:
        return web.json_response(
            {"error": "model_not_found",
             "message": f"Модель с id={model_id} не найдена"},
            status=422,
        )
    if not model.get("is_active"):
        return web.json_response(
            {"error": "model_inactive",
             "message": "Модель деактивирована"},
            status=422,
        )

    # Если у модели нужно выбирать исполнение — оно обязательно
    if model.get("exec_mode") == "choice" and not execution:
        return web.json_response(
            {"error": "execution_required",
             "message": "Для этой модели нужно указать исполнение (st или ne)"},
            status=422,
        )
    # Если exec_mode != choice, игнорируем execution
    if model.get("exec_mode") != "choice":
        execution = None

    # IP-класс
    if model.get("needs_ip") and not ip_class:
        return web.json_response(
            {"error": "ip_class_required",
             "message": "Для этой модели нужно указать IP-класс"},
            status=422,
        )
    if not model.get("needs_ip"):
        ip_class = None

    # --- Проверка сотрудников ---
    if len(worker_ids) != len(set(worker_ids)):
        return web.json_response(
            {"error": "duplicate_workers",
             "message": "Сборщики не должны повторяться"},
            status=422,
        )
    for wid in worker_ids:
        emp = await db.get_employee_by_id(wid)
        if not emp:
            return web.json_response(
                {"error": "worker_not_found",
                 "message": f"Сотрудник с id={wid} не найден"},
                status=422,
            )
        if not emp.get("is_active"):
            return web.json_response(
                {"error": "worker_inactive",
                 "message": f"Сотрудник {emp.get('short_name') or emp.get('full_name')} деактивирован"},
                status=422,
            )

    # --- Создание ---
    try:
        assembly_id = await db.create_assembly(
            model_id=model_id,
            quantity=quantity,
            assembly_date=assembly_date,
            worker_ids=worker_ids,
            execution=execution,
            ip_class=ip_class,
            comment=comment,
            created_by_chat_id=chat_id,
        )
    except Exception as e:
        logger.exception("Atomus API: ошибка создания сборки")
        return web.json_response(
            {"error": "create_failed", "message": str(e)},
            status=500,
        )

    # --- Audit log ---
    try:
        import json
        payload = json.dumps({
            "source": "pwa",
            "model_id": model_id,
            "quantity": quantity,
            "assembly_date": assembly_date,
            "worker_ids": worker_ids,
            "execution": execution,
            "ip_class": ip_class,
        }, ensure_ascii=False)
        await db.log_action(
            chat_id=chat_id,
            action="create_assembly",
            entity="assembly",
            entity_id=assembly_id,
            payload=payload,
        )
    except Exception:
        logger.exception("Atomus API: ошибка audit log при создании сборки")

    return web.json_response({
        "ok": True,
        "id": assembly_id,
        "message": "Сборка записана",
    })


@require_auth
async def get_models(request: web.Request) -> web.Response:
    """Справочник моделей с направлениями.

    Query params:
        direction_id=N — фильтр по направлению
        search=text — поиск (для PWA-поиска)
        include_inactive=true — для админки директора
    """
    direction_id = request.query.get("direction_id")
    search = request.query.get("search")
    include_inactive = request.query.get("include_inactive", "false").lower() == "true"

    if search:
        models = await db.search_models(search, limit=50)
    elif direction_id:
        if include_inactive:
            models = await db.get_all_models_by_direction(int(direction_id))
        else:
            # Активные напрямую + по категориям + по подгруппам
            direct = await db.get_models_by_direction(int(direction_id))
            cats = await db.get_categories(int(direction_id))
            sgs = await db.get_subgroups(int(direction_id))
            models = list(direct)
            for c in cats:
                models.extend(await db.get_models_by_category(c["id"]))
            for s in sgs:
                models.extend(await db.get_models_by_subgroup(s["id"]))
    else:
        # Все направления, все активные модели
        models = []
        directions = await db.get_directions()
        for d in directions:
            direct = await db.get_models_by_direction(d["id"])
            cats = await db.get_categories(d["id"])
            sgs = await db.get_subgroups(d["id"])
            models.extend(direct)
            for c in cats:
                models.extend(await db.get_models_by_category(c["id"]))
            for s in sgs:
                models.extend(await db.get_models_by_subgroup(s["id"]))

    result = []
    for m in models:
        result.append({
            "id": m["id"],
            "name": m["name"],
            "extra": m.get("extra") or "",
            "description": m.get("description") or "",
            "article": m["article"],
            "direction_id": m.get("direction_id"),
            "category_id": m.get("category_id"),
            "subgroup_id": m.get("subgroup_id"),
            "exec_mode": m.get("exec_mode", "none"),
            "exec_fixed": m.get("exec_fixed") or "",
            "exec_label_st": m.get("exec_label_st") or "Стандарт",
            "exec_label_ne": m.get("exec_label_ne") or "Нерж. AISI",
            "needs_ip": bool(m.get("needs_ip")),
            "work_type": m.get("work_type", "full_build"),
            "is_active": bool(m.get("is_active")),
        })

    # Также вернём список направлений для удобства UI
    directions = await db.get_directions()
    directions_list = [
        {"id": d["id"], "code": d.get("code"), "name": d["name"], "subtitle": d.get("subtitle")}
        for d in directions
    ]

    return web.json_response({
        "models": result,
        "directions": directions_list,
    })


@require_auth
async def get_active_employees(request: web.Request) -> web.Response:
    """Список активных сотрудников — нужен для выбора сборщиков при создании сборки.
    Доступен любому залогиненному пользователю (нужен и мастеру, и директору).
    Не выдаёт чувствительные поля (без Telegram ID, телефонов).
    """
    employees = await db.get_active_employees()
    result = []
    for e in employees:
        roles_str = e.get("roles") or ""
        roles = sorted({r.strip() for r in roles_str.split(",") if r.strip()})
        result.append({
            "id": e["id"],
            "full_name": e.get("full_name"),
            "short_name": e.get("short_name"),
            "roles": roles,
        })
    return web.json_response({"employees": result})


@require_master_or_director
async def create_assembly(request: web.Request) -> web.Response:
    """Создаёт новую запись о сборке.

    Тело (POST):
    {
        "model_id": 12,
        "quantity": 3,
        "assembly_date": "2026-05-12",
        "worker_ids": [1, 2],
        "execution": "st" | "ne" | null,
        "ip_class": "IP54" | "IP55" | null,
        "comment": ""
    }
    """
    chat_id = request["chat_id"]
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "bad_request",
                                  "message": "Тело должно быть JSON"}, status=400)

    if not isinstance(data, dict):
        return web.json_response({"error": "bad_request"}, status=400)

    # --- Валидация ---
    errors = []

    model_id = data.get("model_id")
    if not isinstance(model_id, int) or model_id < 1:
        errors.append("Не выбрана модель")
        model = None
    else:
        model = await db.get_model_by_id(model_id)
        if not model:
            errors.append("Модель не найдена")
        elif not model.get("is_active"):
            errors.append("Модель деактивирована — обратитесь к директору")

    quantity = data.get("quantity")
    if not isinstance(quantity, int) or quantity < 1 or quantity > 1000:
        errors.append("Количество должно быть от 1 до 1000")

    assembly_date = data.get("assembly_date")
    if not isinstance(assembly_date, str) or not _is_valid_date(assembly_date):
        errors.append("Неверный формат даты")
    else:
        # Не позволяем вносить будущие даты
        try:
            d = datetime.strptime(assembly_date, "%Y-%m-%d").date()
            if d > date.today():
                errors.append("Нельзя вносить будущую дату")
            # И слишком старые
            if (date.today() - d).days > 365:
                errors.append("Дата слишком старая (более года назад)")
        except Exception:
            pass

    worker_ids = data.get("worker_ids", [])
    if not isinstance(worker_ids, list) or len(worker_ids) == 0:
        errors.append("Выберите хотя бы одного сборщика")
    else:
        # Проверяем что все worker_ids — целые и существующие
        try:
            worker_ids = [int(w) for w in worker_ids]
        except (TypeError, ValueError):
            errors.append("Неверные сборщики")
            worker_ids = []
        else:
            # Проверяем что все указанные сборщики существуют и активны
            active_employees = await db.get_active_employees()
            active_ids = {e["id"] for e in active_employees}
            invalid = [w for w in worker_ids if w not in active_ids]
            if invalid:
                errors.append("Сборщик не найден или деактивирован")

    # Исполнение
    execution = data.get("execution")
    if execution is not None and execution not in ("st", "ne"):
        errors.append("Неверное исполнение")
        execution = None
    if model and not errors:
        if model.get("exec_mode") == "choice" and not execution:
            errors.append("Выберите исполнение (Стандарт или Нерж.)")
        if model.get("exec_mode") == "none" and execution:
            # Если у модели нет выбора — игнорируем
            execution = None
        if model.get("exec_mode") == "fixed":
            # Фиксированное — клиент не задаёт
            execution = None

    # IP
    ip_class = data.get("ip_class")
    if ip_class is not None:
        if not isinstance(ip_class, str) or ip_class not in ("IP54", "IP55", "IP65"):
            errors.append("Неверный IP-класс")
            ip_class = None
    if model and not errors:
        if model.get("needs_ip") and not ip_class:
            errors.append("Выберите IP-класс")
        if not model.get("needs_ip"):
            ip_class = None

    # Комментарий
    comment = data.get("comment", "")
    if comment is None:
        comment = ""
    if not isinstance(comment, str):
        errors.append("Комментарий должен быть текстом")
        comment = ""
    if len(comment) > 500:
        errors.append("Комментарий слишком длинный (макс. 500 символов)")

    # ЭТАП 15: contract_id — опционально, либо целое >0, либо null
    contract_id = data.get("contract_id")
    if contract_id is not None:
        try:
            contract_id = int(contract_id)
            if contract_id <= 0:
                contract_id = None
        except (TypeError, ValueError):
            errors.append("Некорректный договор")
            contract_id = None
    if contract_id:
        contract = await db.get_contract_by_id(contract_id)
        if not contract or not contract.get("is_active"):
            errors.append("Договор не найден или закрыт")
            contract_id = None
        elif contract.get("status") not in ("production", "ready"):
            errors.append("Под этот договор уже нельзя собирать (статус «" + (contract.get("status_label") or "") + "»)")
            contract_id = None

    if errors:
        return web.json_response(
            {"error": "validation_failed",
             "message": "; ".join(errors),
             "errors": errors},
            status=400,
        )

    # --- Создание ---
    try:
        assembly_id = await db.create_assembly(
            model_id=model_id,
            quantity=quantity,
            assembly_date=assembly_date,
            worker_ids=worker_ids,
            execution=execution,
            ip_class=ip_class,
            comment=comment,
            contract_id=contract_id,
            created_by_chat_id=chat_id,
        )
    except Exception as e:
        logger.exception("Atomus API: ошибка создания сборки")
        return web.json_response(
            {"error": "create_failed", "message": str(e)},
            status=500,
        )

    # Audit log
    try:
        await db.log_action(
            chat_id=chat_id,
            action="create_assembly",
            entity="assembly",
            entity_id=assembly_id,
            payload=json.dumps({
                "model_id": model_id,
                "qty": quantity,
                "date": assembly_date,
                "workers": worker_ids,
                "execution": execution,
                "ip": ip_class,
                "source": "pwa",
            }, ensure_ascii=False),
        )
    except Exception:
        logger.exception("Atomus API: ошибка audit-лога")
        # Не критично, продолжаем

    return web.json_response({
        "ok": True,
        "assembly_id": assembly_id,
        "message": "Сборка записана",
    })


# ============ ВНУТРЕННИЕ ХЕЛПЕРЫ ============


def _is_valid_date(s: str) -> bool:
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return True
    except (ValueError, TypeError):
        return False


def _trend_pct(cur: int, prev: int) -> int | None:
    """Процент изменения cur относительно prev. None если prev == 0."""
    if not prev:
        return None
    return round((cur - prev) / prev * 100)


def _exec_label(row: dict) -> str | None:
    """Превращает execution-код в человекочитаемую метку."""
    ex = row.get("execution")
    if ex == "st":
        return row.get("exec_label_st") or "Стандарт"
    if ex == "ne":
        return row.get("exec_label_ne") or "Нерж. AISI"
    return None


# ============================================================================
# ЭТАП 13: ЭНДПОИНТЫ ПРОДАЖ
# ============================================================================


def _serialize_contractor(c: dict) -> dict:
    """Преобразование dict из БД в JSON-ответ."""
    return {
        "id": c["id"],
        "contractor_type": c.get("contractor_type") or "legal",
        "name": c.get("name") or "",
        "inn": c.get("inn") or "",
        "phone": c.get("phone") or "",
        "contact_person": c.get("contact_person") or "",
        "address": c.get("address") or "",
        "comment": c.get("comment") or "",
        "is_active": bool(c.get("is_active")),
        "created_at": c.get("created_at"),
        "updated_at": c.get("updated_at"),
    }


def _serialize_contract(c: dict, with_contractor_count: bool = False) -> dict:
    """Преобразование dict из БД в JSON-ответ.

    Если c содержит поля JOIN (contractor_name, manager_name) — они тоже включаются.
    """
    out = {
        "id": c["id"],
        "number": c.get("number") or "",
        "sign_date": c.get("sign_date"),
        "contractor_id": c.get("contractor_id"),
        "contract_type": c.get("contract_type") or "supply",
        "contract_type_label": CONTRACT_TYPE_LABELS.get(c.get("contract_type") or "", "—"),
        "status": c.get("status") or "production",
        "status_label": CONTRACT_STATUS_LABELS.get(c.get("status") or "", "—"),
        "legal_entity": c.get("legal_entity") or DEFAULT_LEGAL_ENTITY,
        "sum_amount": c.get("sum_amount"),
        "delivery_date": c.get("delivery_date"),
        "delivery_address": c.get("delivery_address") or "",
        "manager_id": c.get("manager_id"),
        "comment": c.get("comment") or "",
        "is_active": bool(c.get("is_active")),
        "created_at": c.get("created_at"),
        "updated_at": c.get("updated_at"),
    }
    # JOIN-поля (могут быть None если контрагент удалён)
    if "contractor_name" in c:
        out["contractor_name"] = c.get("contractor_name") or ""
        out["contractor_inn"] = c.get("contractor_inn") or ""
        out["contractor_phone"] = c.get("contractor_phone") or ""
    if "manager_name" in c:
        out["manager_name"] = c.get("manager_name") or ""
        out["manager_full_name"] = c.get("manager_full_name") or ""
    # Дополнительная инфо о юрлице (для удобства фронта)
    le = get_legal_entity(out["legal_entity"])
    if le:
        out["legal_entity_short"] = le["short_name"]
        out["legal_entity_with_vat"] = le["vat_mode"] == "with_vat"
        out["legal_entity_vat_rate"] = le["vat_rate"]
    return out


# ---------------- ЮРЛИЦА И СПРАВОЧНИКИ ----------------

@require_auth
async def get_legal_entities(request: web.Request) -> web.Response:
    """Возвращает список юрлиц Atomus group (для выбора в КП/договорах).

    Без банковских реквизитов — только основная инфа.
    Полные реквизиты — в отдельном эндпоинте get_legal_entity_full (для PDF КП).
    """
    result = []
    for code, le in LEGAL_ENTITIES.items():
        result.append({
            "code": code,
            "short_name": le["short_name"],
            "full_name": le["full_name"],
            "inn": le["inn"],
            "vat_mode": le["vat_mode"],
            "vat_rate": le["vat_rate"],
            "director_short": le["director_short"],
            "is_default": code == DEFAULT_LEGAL_ENTITY,
        })
    return web.json_response({"legal_entities": result})


@require_auth
async def get_role_list(request: web.Request) -> web.Response:
    """Список всех ролей в системе (для UI выбора при создании сотрудника)."""
    result = []
    for code in ALL_ROLES:
        result.append({
            "code": code,
            "label": ROLE_LABELS.get(code, code),
            "description": ROLE_DESCRIPTIONS.get(code, ""),
        })
    return web.json_response({"roles": result})


# ---------------- КОНТРАГЕНТЫ ----------------

@require_sales_view
async def get_contractors(request: web.Request) -> web.Response:
    """Список контрагентов. Видят все авторизованные.

    Query params:
    - include_inactive=true — включая архив
    - type=legal|private — фильтр по типу
    - search=строка — поиск по name/inn/phone/contact
    """
    include_inactive = request.query.get("include_inactive", "false").lower() == "true"
    ctype = request.query.get("type") or None
    if ctype and ctype not in CONTRACTOR_TYPES:
        ctype = None
    search = request.query.get("search") or None

    rows = await db.get_contractors(
        only_active=not include_inactive,
        contractor_type=ctype,
        search=search,
    )

    # Считаем количество договоров (активных + закрытых) для каждого
    result = []
    for c in rows:
        item = _serialize_contractor(c)
        counts = await db.count_contracts_for_contractor(c["id"])
        item["contracts_active"] = counts["active"]
        item["contracts_closed"] = counts["closed"]
        result.append(item)

    return web.json_response({"contractors": result})


@require_sales_view
async def get_contractor(request: web.Request) -> web.Response:
    """Один контрагент по ID."""
    try:
        cid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request", "message": "Некорректный ID"}, status=400)
    c = await db.get_contractor_by_id(cid)
    if not c:
        return web.json_response({"error": "not_found", "message": "Контрагент не найден"}, status=404)
    item = _serialize_contractor(c)
    counts = await db.count_contracts_for_contractor(c["id"])
    item["contracts_active"] = counts["active"]
    item["contracts_closed"] = counts["closed"]
    return web.json_response(item)


@require_sales_manage
async def create_contractor(request: web.Request) -> web.Response:
    """Создаёт нового контрагента.

    Тело JSON:
        {
          "name": "ООО Северводстрой",
          "contractor_type": "legal" | "private",  // default: legal
          "inn": "6671234567",                      // optional
          "phone": "+7...",                         // optional but recommended
          "contact_person": "Иванов И.И.",          // optional (для юр)
          "address": "г. Екатеринбург...",          // optional
          "comment": ""                             // optional
        }
    """
    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "bad_json"}, status=400)

    name = (data.get("name") or "").strip()
    if not name:
        return web.json_response({"error": "validation", "message": "Укажите название"}, status=400)
    if len(name) > 300:
        return web.json_response({"error": "validation", "message": "Название слишком длинное (макс. 300)"}, status=400)

    ctype = data.get("contractor_type") or "legal"
    if ctype not in CONTRACTOR_TYPES:
        return web.json_response({"error": "validation", "message": "Некорректный тип"}, status=400)

    chat_id = request.get("chat_id")
    new_id = await db.create_contractor(
        name=name,
        contractor_type=ctype,
        inn=data.get("inn"),
        phone=data.get("phone"),
        contact_person=data.get("contact_person"),
        address=data.get("address"),
        comment=data.get("comment"),
        created_by_chat_id=chat_id,
    )
    await db.log_action(chat_id, "create_contractor", "contractor", new_id, name)
    created = await db.get_contractor_by_id(new_id)
    return web.json_response(_serialize_contractor(created), status=201)


@require_sales_manage
async def update_contractor(request: web.Request) -> web.Response:
    """Обновляет контрагента. PATCH-семантика (только переданные поля)."""
    try:
        cid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request"}, status=400)
    existing = await db.get_contractor_by_id(cid)
    if not existing:
        return web.json_response({"error": "not_found"}, status=404)

    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "bad_json"}, status=400)

    # Валидация полей которые меняются
    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name:
            return web.json_response({"error": "validation", "message": "Название не может быть пустым"}, status=400)
        if len(name) > 300:
            return web.json_response({"error": "validation", "message": "Название слишком длинное"}, status=400)

    if "contractor_type" in data:
        if data["contractor_type"] not in CONTRACTOR_TYPES:
            return web.json_response({"error": "validation", "message": "Некорректный тип"}, status=400)

    chat_id = request.get("chat_id")
    await db.update_contractor(
        cid,
        name=data.get("name"),
        contractor_type=data.get("contractor_type"),
        inn=data.get("inn"),
        phone=data.get("phone"),
        contact_person=data.get("contact_person"),
        address=data.get("address"),
        comment=data.get("comment"),
        updated_by_chat_id=chat_id,
    )
    await db.log_action(chat_id, "update_contractor", "contractor", cid, "")
    updated = await db.get_contractor_by_id(cid)
    return web.json_response(_serialize_contractor(updated))


@require_sales_manage
async def delete_contractor(request: web.Request) -> web.Response:
    """Soft-delete контрагента (is_active=0). Не удаляет если есть активные договоры."""
    try:
        cid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request"}, status=400)
    existing = await db.get_contractor_by_id(cid)
    if not existing:
        return web.json_response({"error": "not_found"}, status=404)

    # Защита: нельзя архивировать контрагента у которого есть активные договоры
    counts = await db.count_contracts_for_contractor(cid)
    if counts["active"] > 0:
        return web.json_response(
            {"error": "has_active_contracts",
             "message": f"Нельзя архивировать: есть {counts['active']} активных договоров"},
            status=400,
        )

    chat_id = request.get("chat_id")
    await db.set_contractor_active(cid, False)
    await db.log_action(chat_id, "delete_contractor", "contractor", cid, existing["name"])
    return web.json_response({"ok": True})


# ---------------- ДОГОВОРЫ ----------------

@require_sales_view
async def get_contracts(request: web.Request) -> web.Response:
    """Список договоров с фильтрами.

    Query params:
    - status=production|ready|shipped|closed — фильтр
    - manager_id=N — только договоры менеджера
    - contractor_id=N — только этого контрагента
    - include_inactive=true — включая удалённые
    - search=строка — поиск по номеру/контрагенту
    - limit=N — лимит результатов
    """
    include_inactive = request.query.get("include_inactive", "false").lower() == "true"
    status = request.query.get("status") or None
    if status and status not in CONTRACT_STATUSES:
        status = None
    try:
        manager_id = int(request.query.get("manager_id")) if request.query.get("manager_id") else None
    except ValueError:
        manager_id = None
    try:
        contractor_id = int(request.query.get("contractor_id")) if request.query.get("contractor_id") else None
    except ValueError:
        contractor_id = None
    search = request.query.get("search") or None
    try:
        limit = int(request.query.get("limit")) if request.query.get("limit") else None
    except ValueError:
        limit = None

    rows = await db.get_contracts(
        only_active=not include_inactive,
        status=status,
        manager_id=manager_id,
        contractor_id=contractor_id,
        search=search,
        limit=limit,
    )

    result = [_serialize_contract(c) for c in rows]

    # ЭТАП 15: подгружаем количество сборок для каждого договора (одним запросом)
    contract_ids = [c["id"] for c in result]
    qty_map = await db.get_assembly_counts_for_contracts(contract_ids)
    for c in result:
        c["assemblies_qty"] = qty_map.get(c["id"], 0)

    # Сводка по статусам (для фильтров на фронте)
    counts = await db.count_contracts_by_status()

    return web.json_response({
        "contracts": result,
        "counts": counts,
    })


@require_sales_view
async def get_contract(request: web.Request) -> web.Response:
    """Один договор по ID. Включает список сборок под этот договор."""
    try:
        cid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request"}, status=400)
    c = await db.get_contract_by_id(cid)
    if not c:
        return web.json_response({"error": "not_found"}, status=404)
    # Сборки под этот договор + общее количество
    assemblies = await db.get_assemblies_for_contract(cid)
    total_qty = sum(int(a.get("quantity") or 0) for a in assemblies)
    serialized = _serialize_contract(c)
    serialized["assemblies"] = [
        {
            "id": a["id"],
            "assembly_date": a.get("assembly_date"),
            "quantity": int(a.get("quantity") or 0),
            "execution": a.get("execution"),
            "ip_class": a.get("ip_class"),
            "comment": a.get("comment") or "",
            "created_at": a.get("created_at"),
            "model_id": a.get("model_id"),
            "model_name": a.get("model_name") or "",
            "model_article": a.get("article") or "",
            "model_extra": a.get("model_extra") or "",
            "exec_label_st": a.get("exec_label_st") or "",
            "exec_label_ne": a.get("exec_label_ne") or "",
            "direction_name": a.get("direction_name") or "",
            "workers": [
                {"id": w["id"], "short_name": w.get("short_name") or w.get("full_name") or ""}
                for w in (a.get("workers") or [])
            ],
        }
        for a in assemblies
    ]
    serialized["assemblies_qty"] = total_qty
    return web.json_response(serialized)


@require_sales_manage
async def create_contract(request: web.Request) -> web.Response:
    """Создаёт новый договор.

    Тело JSON:
        {
          "number": "12-Д/2026",                     // обязательно
          "sign_date": "2026-05-05",                 // обязательно YYYY-MM-DD
          "contractor_id": 5,                        // обязательно
          "contract_type": "supply" | "supply_install",
          "legal_entity": "ooo_atomus" | "ooo_td_atomus",
          "sum_amount": 485000,                      // optional
          "delivery_date": "2026-05-22",             // optional
          "delivery_address": "Екатеринбург...",     // optional
          "manager_id": 7,                           // optional, default: создатель
          "comment": ""                              // optional
        }
    Новый договор сразу попадает в статус "production".
    """
    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "bad_json"}, status=400)

    # Обязательные поля
    number = (data.get("number") or "").strip()
    if not number:
        return web.json_response({"error": "validation", "message": "Укажите номер договора"}, status=400)
    if len(number) > 100:
        return web.json_response({"error": "validation", "message": "Номер слишком длинный"}, status=400)

    sign_date = data.get("sign_date") or ""
    if not _is_valid_date(sign_date):
        return web.json_response({"error": "validation", "message": "Некорректная дата подписания"}, status=400)

    try:
        contractor_id = int(data.get("contractor_id") or 0)
    except (TypeError, ValueError):
        contractor_id = 0
    if not contractor_id:
        return web.json_response({"error": "validation", "message": "Укажите контрагента"}, status=400)
    contractor = await db.get_contractor_by_id(contractor_id)
    if not contractor or not contractor.get("is_active"):
        return web.json_response({"error": "validation", "message": "Контрагент не найден или архивирован"}, status=400)

    contract_type = data.get("contract_type") or CONTRACT_TYPE_SUPPLY
    if contract_type not in CONTRACT_TYPES:
        return web.json_response({"error": "validation", "message": "Некорректный тип договора"}, status=400)

    legal_entity = data.get("legal_entity") or DEFAULT_LEGAL_ENTITY
    if legal_entity not in LEGAL_ENTITIES:
        return web.json_response({"error": "validation", "message": "Некорректное юрлицо"}, status=400)

    # Опциональные поля
    sum_amount = data.get("sum_amount")
    if sum_amount is not None:
        try:
            sum_amount = float(sum_amount)
            if sum_amount < 0:
                return web.json_response({"error": "validation", "message": "Сумма не может быть отрицательной"}, status=400)
        except (TypeError, ValueError):
            return web.json_response({"error": "validation", "message": "Некорректная сумма"}, status=400)

    delivery_date = data.get("delivery_date")
    if delivery_date and not _is_valid_date(delivery_date):
        return web.json_response({"error": "validation", "message": "Некорректная дата отгрузки"}, status=400)

    manager_id = data.get("manager_id")
    if manager_id is not None:
        try:
            manager_id = int(manager_id)
        except (TypeError, ValueError):
            return web.json_response({"error": "validation", "message": "Некорректный менеджер"}, status=400)
        emp = await db.get_employee_by_id(manager_id)
        if not emp or not emp.get("is_active"):
            return web.json_response({"error": "validation", "message": "Менеджер не найден"}, status=400)

    chat_id = request.get("chat_id")
    new_id = await db.create_contract(
        number=number,
        sign_date=sign_date,
        contractor_id=contractor_id,
        contract_type=contract_type,
        status=CONTRACT_STATUS_PRODUCTION,  # всегда стартует с "В производстве"
        legal_entity=legal_entity,
        sum_amount=sum_amount,
        delivery_date=delivery_date,
        delivery_address=data.get("delivery_address"),
        manager_id=manager_id,
        comment=data.get("comment"),
        created_by_chat_id=chat_id,
    )
    await db.log_action(chat_id, "create_contract", "contract", new_id, number)
    created = await db.get_contract_by_id(new_id)
    return web.json_response(_serialize_contract(created), status=201)


@require_sales_manage
async def update_contract(request: web.Request) -> web.Response:
    """Обновляет договор. PATCH-семантика. Смена статуса разрешена."""
    try:
        cid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request"}, status=400)
    existing = await db.get_contract_by_id(cid)
    if not existing:
        return web.json_response({"error": "not_found"}, status=404)

    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "bad_json"}, status=400)

    # Валидация
    if "number" in data:
        v = (data.get("number") or "").strip()
        if not v:
            return web.json_response({"error": "validation", "message": "Номер не может быть пустым"}, status=400)
    if "sign_date" in data:
        if not _is_valid_date(data["sign_date"] or ""):
            return web.json_response({"error": "validation", "message": "Некорректная дата подписания"}, status=400)
    if "contractor_id" in data:
        try:
            cid_new = int(data["contractor_id"])
            co = await db.get_contractor_by_id(cid_new)
            if not co:
                return web.json_response({"error": "validation", "message": "Контрагент не найден"}, status=400)
        except (TypeError, ValueError):
            return web.json_response({"error": "validation", "message": "Некорректный контрагент"}, status=400)
    if "contract_type" in data and data["contract_type"] not in CONTRACT_TYPES:
        return web.json_response({"error": "validation", "message": "Некорректный тип"}, status=400)
    if "status" in data and data["status"] not in CONTRACT_STATUSES:
        return web.json_response({"error": "validation", "message": "Некорректный статус"}, status=400)
    if "legal_entity" in data and data["legal_entity"] not in LEGAL_ENTITIES:
        return web.json_response({"error": "validation", "message": "Некорректное юрлицо"}, status=400)

    sum_amount = data.get("sum_amount")
    if "sum_amount" in data and sum_amount is not None:
        try:
            sum_amount = float(sum_amount)
        except (TypeError, ValueError):
            return web.json_response({"error": "validation", "message": "Некорректная сумма"}, status=400)

    delivery_date = data.get("delivery_date")
    if "delivery_date" in data and delivery_date and not _is_valid_date(delivery_date):
        return web.json_response({"error": "validation", "message": "Некорректная дата отгрузки"}, status=400)

    manager_id = data.get("manager_id")
    if "manager_id" in data and manager_id is not None:
        try:
            manager_id = int(manager_id)
            emp = await db.get_employee_by_id(manager_id)
            if not emp:
                return web.json_response({"error": "validation", "message": "Менеджер не найден"}, status=400)
        except (TypeError, ValueError):
            return web.json_response({"error": "validation", "message": "Некорректный менеджер"}, status=400)

    chat_id = request.get("chat_id")
    await db.update_contract(
        cid,
        number=data.get("number"),
        sign_date=data.get("sign_date"),
        contractor_id=data.get("contractor_id"),
        contract_type=data.get("contract_type"),
        status=data.get("status"),
        legal_entity=data.get("legal_entity"),
        sum_amount=sum_amount if "sum_amount" in data else None,
        delivery_date=data.get("delivery_date"),
        delivery_address=data.get("delivery_address"),
        manager_id=manager_id if "manager_id" in data else None,
        comment=data.get("comment"),
        updated_by_chat_id=chat_id,
    )
    await db.log_action(chat_id, "update_contract", "contract", cid, data.get("status") or "")
    updated = await db.get_contract_by_id(cid)
    return web.json_response(_serialize_contract(updated))


@require_director
async def delete_contract(request: web.Request) -> web.Response:
    """Удаление договора (soft-delete). Только директор."""
    try:
        cid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request"}, status=400)
    existing = await db.get_contract_by_id(cid)
    if not existing:
        return web.json_response({"error": "not_found"}, status=404)

    chat_id = request.get("chat_id")
    await db.set_contract_active(cid, False)
    await db.log_action(chat_id, "delete_contract", "contract", cid, existing["number"])
    return web.json_response({"ok": True})


# ============================================================================
# ЭТАП 15: СВЯЗЬ СБОРОК С ДОГОВОРАМИ
# ============================================================================


@require_auth
async def get_contracts_for_picker(request: web.Request) -> web.Response:
    """Список активных договоров для выбора при создании сборки.

    Только статусы 'production' и 'ready'.
    Доступно любому авторизованному (мастер должен видеть договоры под сборку).
    """
    rows = await db.get_active_contracts_for_picker()
    return web.json_response({
        "contracts": [
            {
                "id": r["id"],
                "number": r["number"],
                "status": r["status"],
                "status_label": CONTRACT_STATUS_LABELS.get(r["status"], "—"),
                "sign_date": r.get("sign_date"),
                "delivery_date": r.get("delivery_date"),
                "contractor_name": r.get("contractor_name") or "",
                "manager_name": r.get("manager_name") or "",
            }
            for r in rows
        ]
    })


@require_auth
async def get_contracts_with_progress(request: web.Request) -> web.Response:
    """Активные договоры с количеством собранных сборок.

    Query params:
        for_me=true — только договоры текущего пользователя (если он менеджер)
    """
    chat_id = request["chat_id"]
    for_me = request.query.get("for_me", "false").lower() == "true"

    manager_id = None
    if for_me:
        # Найдём employee_id по telegram_id (chat_id)
        emp = await db.get_employee_by_telegram_id(chat_id)
        if emp:
            manager_id = emp["id"]
        # Если employee не найден — manager_id остаётся None → вернёт все

    rows = await db.get_active_contracts_with_progress(only_for_manager_id=manager_id)

    result = []
    for r in rows:
        le = get_legal_entity(r.get("legal_entity") or "ooo_atomus")
        result.append({
            "id": r["id"],
            "number": r["number"],
            "status": r["status"],
            "status_label": CONTRACT_STATUS_LABELS.get(r["status"], "—"),
            "sign_date": r.get("sign_date"),
            "delivery_date": r.get("delivery_date"),
            "contract_type": r.get("contract_type") or "supply",
            "legal_entity": r.get("legal_entity"),
            "legal_entity_short": le["short_name"] if le else "",
            "sum_amount": r.get("sum_amount"),
            "contractor_name": r.get("contractor_name") or "",
            "contractor_inn": r.get("contractor_inn") or "",
            "manager_name": r.get("manager_name") or "",
            "assemblies_qty": int(r.get("assemblies_qty") or 0),
        })
    return web.json_response({"contracts": result})


# ============================================================================
# ЭТАП 13: УПРАВЛЕНИЕ СОТРУДНИКАМИ ЧЕРЕЗ PWA
# ============================================================================

@require_director
async def create_employee_via_api(request: web.Request) -> web.Response:
    """Создаёт нового сотрудника через PWA. Только директор.

    Тело JSON:
        {
          "full_name": "Иванов Иван Иванович",       // обязательно
          "position": "Менеджер по продажам",         // optional, свободный текст
          "phone": "+7...",                            // optional
          "tab_number": "0034",                        // optional
          "telegram_id": 123456,                       // optional — если хочется сразу привязать
          "roles": ["manager"]                         // одна или несколько ролей
        }
    Если telegram_id не задан, после создания директор сообщает сотруднику login-код
    из бота, и при первом входе сотрудник «склеивается» с этой строкой по chat_id.
    Но для этого нужна также телеграм-команда /login (она уже работает).
    """
    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "bad_json"}, status=400)

    full_name = (data.get("full_name") or "").strip()
    if not full_name:
        return web.json_response({"error": "validation", "message": "Укажите ФИО"}, status=400)
    if len(full_name) > 200:
        return web.json_response({"error": "validation", "message": "ФИО слишком длинное"}, status=400)

    # Роли
    roles_input = data.get("roles") or []
    if isinstance(roles_input, str):
        roles_input = [r.strip() for r in roles_input.split(",") if r.strip()]
    valid_roles = [r for r in roles_input if r in ALL_ROLES]
    if not valid_roles:
        return web.json_response(
            {"error": "validation", "message": "Укажите хотя бы одну роль"},
            status=400,
        )
    roles_str = ",".join(valid_roles)

    # Telegram ID (опционально)
    telegram_id = data.get("telegram_id")
    if telegram_id is not None:
        try:
            telegram_id = int(telegram_id)
            if telegram_id <= 0:
                telegram_id = None
        except (TypeError, ValueError):
            telegram_id = None

    chat_id = request.get("chat_id")
    new_id = await db.create_employee(
        full_name=full_name,
        position=(data.get("position") or "").strip(),
        phone=(data.get("phone") or "").strip(),
        email=(data.get("email") or "").strip(),
        tab_number=(data.get("tab_number") or "").strip(),
        telegram_id=telegram_id,
        roles=roles_str,
    )
    await db.log_action(chat_id, "create_employee", "employee", new_id, full_name)

    # Обновляем кэш ролей
    cache = await db.load_roles_to_cache()
    from .config import set_roles_cache
    set_roles_cache(cache)

    created = await db.get_employee_by_id(new_id)
    return web.json_response({
        "id": created["id"],
        "full_name": created.get("full_name") or "",
        "short_name": created.get("short_name") or "",
        "position": created.get("position") or "",
        "phone": created.get("phone") or "",
        "tab_number": created.get("tab_number") or "",
        "telegram_id": created.get("telegram_id"),
        "roles": sorted(valid_roles),
        "is_active": True,
    }, status=201)


@require_director
async def update_employee_via_api(request: web.Request) -> web.Response:
    """Обновляет сотрудника. Только директор. PATCH-семантика."""
    try:
        eid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request"}, status=400)
    existing = await db.get_employee_by_id(eid)
    if not existing:
        return web.json_response({"error": "not_found"}, status=404)

    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "bad_json"}, status=400)

    # Если меняются роли
    roles_str = None
    if "roles" in data:
        roles_input = data.get("roles") or []
        if isinstance(roles_input, str):
            roles_input = [r.strip() for r in roles_input.split(",") if r.strip()]
        valid_roles = [r for r in roles_input if r in ALL_ROLES]
        if not valid_roles:
            return web.json_response(
                {"error": "validation", "message": "У сотрудника должна быть хотя бы одна роль"},
                status=400,
            )

        # Защита: нельзя снять директорство с последнего директора
        if ROLE_DIRECTOR in existing.get("roles", "") and ROLE_DIRECTOR not in valid_roles:
            director_count = await db.count_directors()
            if director_count <= 1:
                return web.json_response(
                    {"error": "validation",
                     "message": "Нельзя снять роль директора с последнего директора"},
                    status=400,
                )

        roles_str = ",".join(valid_roles)

    if "full_name" in data:
        fn = (data.get("full_name") or "").strip()
        if not fn:
            return web.json_response({"error": "validation", "message": "ФИО не может быть пустым"}, status=400)

    telegram_id = data.get("telegram_id")
    if "telegram_id" in data and telegram_id is not None:
        try:
            telegram_id = int(telegram_id)
            if telegram_id <= 0:
                telegram_id = None
        except (TypeError, ValueError):
            telegram_id = None

    chat_id = request.get("chat_id")
    await db.update_employee(
        eid,
        full_name=data.get("full_name"),
        position=data.get("position"),
        phone=data.get("phone"),
        email=data.get("email"),
        tab_number=data.get("tab_number"),
        telegram_id=telegram_id if "telegram_id" in data else None,
        roles=roles_str,
    )
    await db.log_action(chat_id, "update_employee", "employee", eid, "")

    # Обновляем кэш ролей если роли менялись или менялся telegram_id
    if roles_str is not None or "telegram_id" in data:
        cache = await db.load_roles_to_cache()
        from .config import set_roles_cache
        set_roles_cache(cache)

    updated = await db.get_employee_by_id(eid)
    roles = sorted({r.strip() for r in (updated.get("roles") or "").split(",") if r.strip()})
    return web.json_response({
        "id": updated["id"],
        "full_name": updated.get("full_name") or "",
        "short_name": updated.get("short_name") or "",
        "position": updated.get("position") or "",
        "phone": updated.get("phone") or "",
        "email": updated.get("email") or "",
        "tab_number": updated.get("tab_number") or "",
        "telegram_id": updated.get("telegram_id"),
        "roles": roles,
        "is_active": bool(updated.get("is_active")),
    })


@require_director
async def set_employee_active_via_api(request: web.Request) -> web.Response:
    """Активирует/деактивирует сотрудника. Только директор."""
    try:
        eid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request"}, status=400)
    existing = await db.get_employee_by_id(eid)
    if not existing:
        return web.json_response({"error": "not_found"}, status=404)

    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "bad_json"}, status=400)

    is_active = bool(data.get("is_active"))

    # Защита: нельзя деактивировать последнего директора
    if not is_active and ROLE_DIRECTOR in (existing.get("roles") or ""):
        director_count = await db.count_directors()
        if director_count <= 1:
            return web.json_response(
                {"error": "validation",
                 "message": "Нельзя деактивировать последнего директора"},
                status=400,
            )

    chat_id = request.get("chat_id")
    await db.set_employee_active(eid, is_active)
    await db.log_action(
        chat_id,
        "activate_employee" if is_active else "deactivate_employee",
        "employee", eid,
        existing.get("full_name") or "",
    )

    # Перестраиваем кэш ролей
    cache = await db.load_roles_to_cache()
    from .config import set_roles_cache
    set_roles_cache(cache)

    return web.json_response({"ok": True, "is_active": is_active})


# ============================================================================
# ЭТАП 14А: ПРОДАЖНАЯ НОМЕНКЛАТУРА
# ============================================================================


def _serialize_sale_product(p: dict, with_links: bool = False) -> dict:
    out = {
        "id": p["id"],
        "name": p.get("name") or "",
        "description": p.get("description") or "",
        "product_type": p.get("product_type") or "goods",
        "product_type_label": SALE_PRODUCT_TYPE_LABELS.get(p.get("product_type") or "", "—"),
        "base_price": p.get("base_price"),
        "unit": p.get("unit") or "шт.",
        "category_id": p.get("category_id"),               # ЭТАП 17
        "category_name": p.get("category_name") or "",     # ЭТАП 17
        "sort_order": p.get("sort_order") or 0,
        "is_active": bool(p.get("is_active")),
        "created_at": p.get("created_at"),
        "updated_at": p.get("updated_at"),
    }
    if with_links and "linked_models" in p:
        out["linked_models"] = [
            {
                "model_id": lm["model_id"],
                "model_name": lm.get("model_name") or "",
                "model_extra": lm.get("model_extra") or "",
                "model_article": lm.get("model_article") or "",
                "direction_name": lm.get("direction_name") or "",
                "qty_per_product": lm.get("qty_per_product") or 1,
            }
            for lm in (p.get("linked_models") or [])
        ]
    return out


@require_sales_view
async def get_sale_products(request: web.Request) -> web.Response:
    """Список продажных позиций.

    Query: type=goods|service, search=строка, include_inactive=true, category_id=N|0(=без категории)
    """
    include_inactive = request.query.get("include_inactive", "false").lower() == "true"
    ptype = request.query.get("type") or None
    if ptype and ptype not in SALE_PRODUCT_TYPES:
        ptype = None
    search = request.query.get("search") or None

    # ЭТАП 17: фильтр по категории
    category_id = request.query.get("category_id")
    cat_filter = None
    if category_id is not None and category_id != "":
        try:
            cat_filter = int(category_id)
        except (TypeError, ValueError):
            cat_filter = None

    rows = await db.get_sale_products(
        only_active=not include_inactive,
        product_type=ptype,
        search=search,
        category_id=cat_filter,
    )
    counts = await db.count_sale_products()
    return web.json_response({
        "products": [_serialize_sale_product(p) for p in rows],
        "counts": counts,
    })


@require_sales_view
async def get_sale_product(request: web.Request) -> web.Response:
    """Одна продажная позиция со связанными сборками."""
    try:
        pid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request"}, status=400)
    p = await db.get_sale_product_by_id(pid)
    if not p:
        return web.json_response({"error": "not_found"}, status=404)
    return web.json_response(_serialize_sale_product(p, with_links=True))


@require_sales_manage
async def create_sale_product(request: web.Request) -> web.Response:
    """Создаёт новую продажную позицию.

    Тело JSON:
        {
          "name": "Увлажнитель промышленный УУЗ-300",   // обязательно
          "description": "...",                          // optional
          "product_type": "goods" | "service",           // default: goods
          "base_price": 50000,                           // optional (₽, без НДС)
          "unit": "шт.",                                 // default: шт.
          "linked_model_ids": [12, 34]                   // optional, ID сборочных моделей
        }
    """
    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "bad_json"}, status=400)

    name = (data.get("name") or "").strip()
    if not name:
        return web.json_response({"error": "validation", "message": "Укажите название"}, status=400)
    if len(name) > 300:
        return web.json_response({"error": "validation", "message": "Название слишком длинное"}, status=400)

    ptype = data.get("product_type") or "goods"
    if ptype not in SALE_PRODUCT_TYPES:
        return web.json_response({"error": "validation", "message": "Некорректный тип"}, status=400)

    base_price = data.get("base_price")
    if base_price is not None and base_price != "":
        try:
            base_price = float(base_price)
            if base_price < 0:
                return web.json_response({"error": "validation", "message": "Цена не может быть отрицательной"}, status=400)
        except (TypeError, ValueError):
            return web.json_response({"error": "validation", "message": "Некорректная цена"}, status=400)
    else:
        base_price = None

    unit = (data.get("unit") or "шт.").strip()
    if unit not in SALE_PRODUCT_UNITS:
        unit = "шт."

    # ЭТАП 17: валидация category_id
    category_id = data.get("category_id")
    if category_id is not None and category_id != "":
        try:
            category_id = int(category_id)
            cat = await db.get_sale_category_by_id(category_id)
            if not cat or not cat.get("is_active"):
                return web.json_response({"error": "validation", "message": "Категория не найдена"}, status=400)
        except (TypeError, ValueError):
            category_id = None
    else:
        category_id = None

    # Привязки моделей
    linked = data.get("linked_model_ids") or []
    if not isinstance(linked, list):
        linked = []
    valid_model_ids = []
    for mid in linked:
        try:
            mid = int(mid)
            m = await db.get_model_by_id(mid)
            if m:
                valid_model_ids.append(mid)
        except (TypeError, ValueError):
            continue

    chat_id = request.get("chat_id")
    new_id = await db.create_sale_product(
        name=name,
        product_type=ptype,
        description=data.get("description"),
        base_price=base_price,
        unit=unit,
        category_id=category_id,
        linked_model_ids=valid_model_ids,
        created_by_chat_id=chat_id,
    )
    await db.log_action(chat_id, "create_sale_product", "sale_product", new_id, name)
    created = await db.get_sale_product_by_id(new_id)
    return web.json_response(_serialize_sale_product(created, with_links=True), status=201)


@require_sales_manage
async def update_sale_product(request: web.Request) -> web.Response:
    """Обновляет продажную позицию. PATCH-семантика."""
    try:
        pid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request"}, status=400)
    existing = await db.get_sale_product_by_id(pid)
    if not existing:
        return web.json_response({"error": "not_found"}, status=404)

    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "bad_json"}, status=400)

    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name:
            return web.json_response({"error": "validation", "message": "Название не может быть пустым"}, status=400)
    if "product_type" in data and data["product_type"] not in SALE_PRODUCT_TYPES:
        return web.json_response({"error": "validation", "message": "Некорректный тип"}, status=400)

    base_price = data.get("base_price")
    if "base_price" in data:
        if base_price is not None and base_price != "":
            try:
                base_price = float(base_price)
                if base_price < 0:
                    return web.json_response({"error": "validation", "message": "Цена не может быть отрицательной"}, status=400)
            except (TypeError, ValueError):
                return web.json_response({"error": "validation", "message": "Некорректная цена"}, status=400)
        else:
            base_price = None  # явный сброс

    unit = data.get("unit")
    if unit is not None and unit not in SALE_PRODUCT_UNITS:
        unit = "шт."

    # ЭТАП 17: category_id обрабатываем явно
    set_category = "category_id" in data
    cat_id_value = None
    if set_category:
        raw = data.get("category_id")
        if raw is not None and raw != "":
            try:
                cat_id_value = int(raw)
                cat = await db.get_sale_category_by_id(cat_id_value)
                if not cat or not cat.get("is_active"):
                    return web.json_response({"error": "validation", "message": "Категория не найдена"}, status=400)
            except (TypeError, ValueError):
                return web.json_response({"error": "validation", "message": "Некорректная категория"}, status=400)
        else:
            cat_id_value = None   # явный сброс

    # Привязки (если переданы — полностью замещаем)
    linked = data.get("linked_model_ids")
    valid_model_ids = None
    if linked is not None:
        if not isinstance(linked, list):
            linked = []
        valid_model_ids = []
        for mid in linked:
            try:
                mid = int(mid)
                m = await db.get_model_by_id(mid)
                if m:
                    valid_model_ids.append(mid)
            except (TypeError, ValueError):
                continue

    chat_id = request.get("chat_id")
    await db.update_sale_product(
        pid,
        name=data.get("name"),
        description=data.get("description"),
        product_type=data.get("product_type"),
        base_price=base_price if "base_price" in data else None,
        unit=unit,
        category_id=cat_id_value,
        set_category=set_category,
        linked_model_ids=valid_model_ids,
        updated_by_chat_id=chat_id,
    )
    await db.log_action(chat_id, "update_sale_product", "sale_product", pid, "")
    updated = await db.get_sale_product_by_id(pid)
    return web.json_response(_serialize_sale_product(updated, with_links=True))


@require_sales_manage
async def delete_sale_product(request: web.Request) -> web.Response:
    """Soft-delete продажной позиции."""
    try:
        pid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request"}, status=400)
    existing = await db.get_sale_product_by_id(pid)
    if not existing:
        return web.json_response({"error": "not_found"}, status=404)
    chat_id = request.get("chat_id")
    await db.set_sale_product_active(pid, False)
    await db.log_action(chat_id, "delete_sale_product", "sale_product", pid, existing.get("name") or "")
    return web.json_response({"ok": True})


@require_auth
async def get_sale_product_units(request: web.Request) -> web.Response:
    """Список допустимых единиц измерения (для UI)."""
    return web.json_response({"units": list(SALE_PRODUCT_UNITS)})


# ============================================================================
# ЭТАП 14Б: КОММЕРЧЕСКИЕ ПРЕДЛОЖЕНИЯ — КП
# ============================================================================


def _serialize_offer_item(it: dict) -> dict:
    return {
        "id": it.get("id"),
        "sale_product_id": it.get("sale_product_id"),
        "sort_order": it.get("sort_order") or 0,
        "name": it.get("name") or "",
        "description": it.get("description") or "",
        "unit": it.get("unit") or "шт.",
        "qty": float(it.get("qty") or 0),
        "price": float(it.get("price") or 0),
        "discount_pct": float(it.get("discount_pct") or 0),
        "line_total": float(it.get("line_total") or 0),
    }


def _serialize_offer(o: dict, with_items: bool = False) -> dict:
    out = {
        "id": o["id"],
        "number": o.get("number") or "",
        "base_number": o.get("base_number") or "",
        "version": o.get("version") or 1,
        "seq_number": o.get("seq_number") or 0,
        "manager_id": o.get("manager_id"),
        "contractor_id": o.get("contractor_id"),
        "legal_entity": o.get("legal_entity") or "ooo_atomus",
        "status": o.get("status") or "draft",
        "status_label": OFFER_STATUS_LABELS.get(o.get("status") or "", "—"),
        "valid_until": o.get("valid_until"),
        "valid_duration_value": o.get("valid_duration_value"),
        "valid_duration_unit": o.get("valid_duration_unit") or "days",
        "production_term": o.get("production_term") or "",
        "production_days": o.get("production_days"),
        "payment_terms": o.get("payment_terms") or "",
        "delivery_terms": o.get("delivery_terms") or "",
        "comment_internal": o.get("comment_internal") or "",
        "comment_client": o.get("comment_client") or "",
        "total_sum": float(o.get("total_sum") or 0),
        "is_active": bool(o.get("is_active")),
        "created_at": o.get("created_at"),
        "updated_at": o.get("updated_at"),
    }
    # JOIN-поля
    if "contractor_name" in o:
        out["contractor_name"] = o.get("contractor_name") or ""
        out["contractor_inn"] = o.get("contractor_inn") or ""
        out["contractor_phone"] = o.get("contractor_phone") or ""
    if "contractor_contact_person" in o:
        out["contractor_contact_person"] = o.get("contractor_contact_person") or ""
        out["contractor_address"] = o.get("contractor_address") or ""
    if "manager_name" in o:
        out["manager_name"] = o.get("manager_name") or ""
        out["manager_full_name"] = o.get("manager_full_name") or ""
        out["manager_phone"] = o.get("manager_phone") or ""
        out["manager_email"] = o.get("manager_email") or ""
    # Юрлицо
    le = get_legal_entity(out["legal_entity"])
    if le:
        out["legal_entity_short"] = le["short_name"]
        out["legal_entity_with_vat"] = le["vat_mode"] == "with_vat"
        out["legal_entity_vat_rate"] = le["vat_rate"]
    # Позиции
    if with_items and "items" in o:
        out["items"] = [_serialize_offer_item(it) for it in (o.get("items") or [])]
    return out


@require_sales_view
async def get_sale_offers(request: web.Request) -> web.Response:
    """Список КП (только последние версии).

    Query: status, manager_id, contractor_id, search, limit, include_versions=true
    """
    status = request.query.get("status") or None
    if status and status not in OFFER_STATUSES:
        status = None
    try:
        manager_id = int(request.query.get("manager_id")) if request.query.get("manager_id") else None
    except ValueError:
        manager_id = None
    try:
        contractor_id = int(request.query.get("contractor_id")) if request.query.get("contractor_id") else None
    except ValueError:
        contractor_id = None
    search = request.query.get("search") or None
    try:
        limit = int(request.query.get("limit")) if request.query.get("limit") else None
    except ValueError:
        limit = None
    include_versions = request.query.get("include_versions", "false").lower() == "true"

    rows = await db.get_sale_offers(
        only_active=True,
        only_latest_versions=not include_versions,
        status=status,
        manager_id=manager_id,
        contractor_id=contractor_id,
        search=search,
        limit=limit,
    )
    counts = await db.count_offers_by_status()
    return web.json_response({
        "offers": [_serialize_offer(o) for o in rows],
        "counts": counts,
    })


@require_sales_view
async def get_sale_offer(request: web.Request) -> web.Response:
    """Одно КП по ID, с позициями."""
    try:
        oid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request"}, status=400)
    o = await db.get_sale_offer_by_id(oid)
    if not o:
        return web.json_response({"error": "not_found"}, status=404)
    return web.json_response(_serialize_offer(o, with_items=True))


@require_sales_view
async def get_offer_versions(request: web.Request) -> web.Response:
    """Все версии КП с этим base_number (для истории)."""
    base = request.match_info.get("base", "")
    if not base:
        return web.json_response({"error": "bad_request"}, status=400)
    rows = await db.get_offer_versions_for_base(base)
    return web.json_response({"versions": [_serialize_offer(o) for o in rows]})


def _validate_offer_items(items_input) -> tuple[list[dict] | None, str | None]:
    """Валидирует список позиций. Возвращает (нормализованный список, ошибка-или-None)."""
    if not isinstance(items_input, list):
        return None, "Позиции должны быть массивом"
    if not items_input:
        return None, "КП должно содержать хотя бы одну позицию"
    result = []
    for i, it in enumerate(items_input):
        if not isinstance(it, dict):
            return None, f"Позиция #{i+1}: некорректный формат"
        name = (it.get("name") or "").strip()
        if not name:
            return None, f"Позиция #{i+1}: укажите название"
        try:
            qty = float(it.get("qty") or 1)
            if qty <= 0:
                return None, f"Позиция «{name}»: количество должно быть положительным"
        except (TypeError, ValueError):
            return None, f"Позиция «{name}»: некорректное количество"
        try:
            price = float(it.get("price") or 0)
            if price < 0:
                return None, f"Позиция «{name}»: цена не может быть отрицательной"
        except (TypeError, ValueError):
            return None, f"Позиция «{name}»: некорректная цена"
        try:
            discount = float(it.get("discount_pct") or 0)
            if discount < 0 or discount > 100:
                return None, f"Позиция «{name}»: скидка должна быть от 0 до 100%"
        except (TypeError, ValueError):
            return None, f"Позиция «{name}»: некорректная скидка"
        result.append({
            "sale_product_id": it.get("sale_product_id"),
            "name": name,
            "description": (it.get("description") or "").strip() or None,
            "unit": (it.get("unit") or "шт.").strip(),
            "qty": qty,
            "price": price,
            "discount_pct": discount,
        })
    return result, None


@require_sales_manage
async def create_sale_offer(request: web.Request) -> web.Response:
    """Создаёт новое КП (всегда версия 1).

    Тело JSON:
        {
          "manager_id": 5,                     // обязательно
          "contractor_id": 12,                 // обязательно
          "legal_entity": "ooo_atomus",
          "valid_until": "2026-05-27",
          "production_term": "3-4 недели",
          "payment_terms": "30% предоплата, 70% по готовности",
          "delivery_terms": "Самовывоз / доставка ТК",
          "comment_internal": "...",
          "comment_client": "...",
          "items": [
            {"sale_product_id": 5, "name": "...", "qty": 1, "price": 50000, "discount_pct": 5}
          ]
        }
    """
    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "bad_json"}, status=400)

    # Менеджер обязателен
    try:
        manager_id = int(data.get("manager_id") or 0)
    except (TypeError, ValueError):
        manager_id = 0
    if not manager_id:
        return web.json_response({"error": "validation", "message": "Укажите менеджера"}, status=400)
    manager = await db.get_employee_by_id(manager_id)
    if not manager or not manager.get("is_active"):
        return web.json_response({"error": "validation", "message": "Менеджер не найден или деактивирован"}, status=400)

    # Контрагент обязателен
    try:
        contractor_id = int(data.get("contractor_id") or 0)
    except (TypeError, ValueError):
        contractor_id = 0
    if not contractor_id:
        return web.json_response({"error": "validation", "message": "Укажите контрагента"}, status=400)
    contractor = await db.get_contractor_by_id(contractor_id)
    if not contractor or not contractor.get("is_active"):
        return web.json_response({"error": "validation", "message": "Контрагент не найден"}, status=400)

    # Юрлицо
    legal_entity = data.get("legal_entity") or DEFAULT_LEGAL_ENTITY
    if legal_entity not in LEGAL_ENTITIES:
        return web.json_response({"error": "validation", "message": "Некорректное юрлицо"}, status=400)

    # Срок действия (опц)
    valid_until = data.get("valid_until")
    if valid_until and not _is_valid_date(valid_until):
        return web.json_response({"error": "validation", "message": "Некорректный срок действия КП"}, status=400)

    # ЭТАП 16А: длительность вместо даты (если указана — приоритет)
    valid_duration_value = data.get("valid_duration_value")
    valid_duration_unit = data.get("valid_duration_unit")
    if valid_duration_value is not None:
        try:
            valid_duration_value = int(valid_duration_value)
            if valid_duration_value < 1 or valid_duration_value > 365:
                return web.json_response(
                    {"error": "validation", "message": "Срок действия должен быть от 1 до 365"},
                    status=400,
                )
        except (TypeError, ValueError):
            return web.json_response(
                {"error": "validation", "message": "Некорректный срок действия (число)"},
                status=400,
            )
    if valid_duration_unit is not None and valid_duration_unit not in ("days", "weeks", "months"):
        return web.json_response(
            {"error": "validation", "message": "Единица срока: days/weeks/months"},
            status=400,
        )

    # ЭТАП 16А-2: срок изготовления в рабочих днях
    production_days = data.get("production_days")
    if production_days is not None:
        try:
            production_days = int(production_days)
            if production_days < 0 or production_days > 365:
                return web.json_response(
                    {"error": "validation", "message": "Срок изготовления от 0 до 365 дней"},
                    status=400,
                )
            if production_days == 0:
                production_days = None
        except (TypeError, ValueError):
            return web.json_response(
                {"error": "validation", "message": "Некорректный срок изготовления"},
                status=400,
            )

    # Позиции
    items, err = _validate_offer_items(data.get("items") or [])
    if err:
        return web.json_response({"error": "validation", "message": err}, status=400)

    chat_id = request.get("chat_id")
    try:
        new_id = await db.create_sale_offer(
            manager_id=manager_id,
            contractor_id=contractor_id,
            legal_entity=legal_entity,
            valid_until=valid_until,
            valid_duration_value=valid_duration_value,
            valid_duration_unit=valid_duration_unit,
            production_term=(data.get("production_term") or "").strip() or None,
            production_days=production_days,
            payment_terms=(data.get("payment_terms") or "").strip() or None,
            delivery_terms=(data.get("delivery_terms") or "").strip() or None,
            comment_internal=(data.get("comment_internal") or "").strip() or None,
            comment_client=(data.get("comment_client") or "").strip() or None,
            items=items,
            created_by_chat_id=chat_id,
        )
    except ValueError as e:
        return web.json_response({"error": "validation", "message": str(e)}, status=400)

    created = await db.get_sale_offer_by_id(new_id)
    await db.log_action(chat_id, "create_offer", "sale_offer", new_id, created.get("number") or "")
    return web.json_response(_serialize_offer(created, with_items=True), status=201)


@require_sales_manage
async def update_sale_offer(request: web.Request) -> web.Response:
    """Обновляет КП БЕЗ создания новой версии. PATCH-семантика."""
    try:
        oid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request"}, status=400)
    existing = await db.get_sale_offer_by_id(oid)
    if not existing:
        return web.json_response({"error": "not_found"}, status=404)

    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "bad_json"}, status=400)

    # Валидации
    if "contractor_id" in data:
        try:
            cid = int(data["contractor_id"])
            co = await db.get_contractor_by_id(cid)
            if not co:
                return web.json_response({"error": "validation", "message": "Контрагент не найден"}, status=400)
        except (TypeError, ValueError):
            return web.json_response({"error": "validation", "message": "Некорректный контрагент"}, status=400)

    if "legal_entity" in data and data["legal_entity"] not in LEGAL_ENTITIES:
        return web.json_response({"error": "validation", "message": "Некорректное юрлицо"}, status=400)

    if "status" in data and data["status"] not in OFFER_STATUSES:
        return web.json_response({"error": "validation", "message": "Некорректный статус"}, status=400)

    if "valid_until" in data and data["valid_until"] and not _is_valid_date(data["valid_until"]):
        return web.json_response({"error": "validation", "message": "Некорректный срок действия"}, status=400)

    # ЭТАП 16А: валидация valid_duration_*
    if "valid_duration_value" in data and data["valid_duration_value"] is not None:
        try:
            v = int(data["valid_duration_value"])
            if v < 1 or v > 365:
                return web.json_response(
                    {"error": "validation", "message": "Срок действия должен быть от 1 до 365"},
                    status=400,
                )
            data["valid_duration_value"] = v
        except (TypeError, ValueError):
            return web.json_response(
                {"error": "validation", "message": "Некорректный срок действия"},
                status=400,
            )
    if "valid_duration_unit" in data and data["valid_duration_unit"] and data["valid_duration_unit"] not in ("days", "weeks", "months"):
        return web.json_response(
            {"error": "validation", "message": "Единица срока: days/weeks/months"},
            status=400,
        )

    # ЭТАП 16А-2: production_days
    if "production_days" in data and data["production_days"] is not None:
        try:
            pd = int(data["production_days"])
            if pd < 0 or pd > 365:
                return web.json_response(
                    {"error": "validation", "message": "Срок изготовления от 0 до 365 дней"},
                    status=400,
                )
            data["production_days"] = pd if pd > 0 else None
        except (TypeError, ValueError):
            return web.json_response(
                {"error": "validation", "message": "Некорректный срок изготовления"},
                status=400,
            )

    items_validated = None
    if "items" in data:
        items_validated, err = _validate_offer_items(data["items"])
        if err:
            return web.json_response({"error": "validation", "message": err}, status=400)

    chat_id = request.get("chat_id")
    fields = {}
    for k in ("contractor_id", "legal_entity", "status", "valid_until",
              "valid_duration_value", "valid_duration_unit",     # ЭТАП 16А
              "production_term", "production_days",              # ЭТАП 16А-2
              "payment_terms", "delivery_terms",
              "comment_internal", "comment_client"):
        if k in data:
            fields[k] = data[k]
    if items_validated is not None:
        fields["items"] = items_validated

    await db.update_sale_offer(oid, updated_by_chat_id=chat_id, **fields)
    await db.log_action(chat_id, "update_offer", "sale_offer", oid, existing.get("number") or "")
    updated = await db.get_sale_offer_by_id(oid)
    return web.json_response(_serialize_offer(updated, with_items=True))


@require_sales_manage
async def create_offer_version(request: web.Request) -> web.Response:
    """Создаёт НОВУЮ ВЕРСИЮ существующего КП.

    Берёт base_number, увеличивает версию, опц. применяет изменения из body.
    """
    try:
        oid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request"}, status=400)
    existing = await db.get_sale_offer_by_id(oid)
    if not existing:
        return web.json_response({"error": "not_found"}, status=404)

    try:
        data = await request.json() if request.content_length else {}
    except json.JSONDecodeError:
        data = {}

    # Валидации (если что-то меняется)
    changes = {}
    if "contractor_id" in data:
        try:
            cid = int(data["contractor_id"])
            co = await db.get_contractor_by_id(cid)
            if not co:
                return web.json_response({"error": "validation", "message": "Контрагент не найден"}, status=400)
            changes["contractor_id"] = cid
        except (TypeError, ValueError):
            return web.json_response({"error": "validation", "message": "Некорректный контрагент"}, status=400)
    if "legal_entity" in data:
        if data["legal_entity"] not in LEGAL_ENTITIES:
            return web.json_response({"error": "validation", "message": "Некорректное юрлицо"}, status=400)
        changes["legal_entity"] = data["legal_entity"]
    if "valid_until" in data and data["valid_until"]:
        if not _is_valid_date(data["valid_until"]):
            return web.json_response({"error": "validation", "message": "Некорректный срок действия"}, status=400)
        changes["valid_until"] = data["valid_until"]
    for k in ("production_term", "payment_terms", "delivery_terms",
              "comment_internal", "comment_client"):
        if k in data:
            changes[k] = data[k]
    if "items" in data:
        items_validated, err = _validate_offer_items(data["items"])
        if err:
            return web.json_response({"error": "validation", "message": err}, status=400)
        changes["items"] = items_validated

    chat_id = request.get("chat_id")
    try:
        new_id = await db.create_offer_new_version(
            source_offer_id=oid, updated_by_chat_id=chat_id, **changes
        )
    except ValueError as e:
        return web.json_response({"error": "validation", "message": str(e)}, status=400)

    new_offer = await db.get_sale_offer_by_id(new_id)
    await db.log_action(chat_id, "create_offer_version", "sale_offer", new_id, new_offer.get("number") or "")
    return web.json_response(_serialize_offer(new_offer, with_items=True), status=201)


@require_sales_manage
async def delete_sale_offer(request: web.Request) -> web.Response:
    """Soft-delete КП. Удаляет ТОЛЬКО эту версию, не все версии."""
    try:
        oid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request"}, status=400)
    existing = await db.get_sale_offer_by_id(oid)
    if not existing:
        return web.json_response({"error": "not_found"}, status=404)
    chat_id = request.get("chat_id")
    await db.set_offer_active(oid, False)
    await db.log_action(chat_id, "delete_offer", "sale_offer", oid, existing.get("number") or "")
    return web.json_response({"ok": True})


@require_auth
async def get_offer_statuses(request: web.Request) -> web.Response:
    """Список статусов КП с метками."""
    return web.json_response({
        "statuses": [
            {"code": s, "label": OFFER_STATUS_LABELS[s]} for s in OFFER_STATUSES
        ]
    })


@require_sales_view
async def get_offer_pdf(request: web.Request) -> web.Response:
    """Отдаёт PDF одного КП.

    Доступ: любой авторизованный (require_sales_view = любой авторизованный).
    Бухгалтер тоже может скачать.
    """
    try:
        oid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_request"}, status=400)

    offer = await db.get_sale_offer_by_id(oid)
    if not offer:
        return web.json_response({"error": "not_found"}, status=404)

    # Сериализуем как для JSON (с items и JOIN-полями), но в виде dict
    serialized = _serialize_offer(offer, with_items=True)

    # Генерим PDF (в отдельном потоке, чтобы не блокировать event loop)
    try:
        from . import pdf_offers
        loop = asyncio.get_event_loop()
        pdf_bytes = await loop.run_in_executor(None, pdf_offers.generate_offer_pdf, serialized)
    except Exception as e:
        logger.exception("PDF generation failed for offer %s", oid)
        return web.json_response(
            {"error": "pdf_failed", "message": f"Ошибка генерации PDF: {e}"},
            status=500,
        )

    # Имя файла (для скачивания)
    number = serialized.get("number") or f"KP-{oid}"
    # Заменяем спецсимволы для безопасности
    safe_name = number.replace("/", "-").replace("\\", "-").replace(" ", "_")
    filename = f"{safe_name}.pdf"

    # Возвращаем с правильными заголовками
    chat_id = request.get("chat_id")
    await db.log_action(chat_id, "download_offer_pdf", "sale_offer", oid, number)

    return web.Response(
        body=pdf_bytes,
        content_type="application/pdf",
        headers={
            # inline — открыть в браузере; attachment — сразу скачать
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "no-cache",
        },
    )


# ============ ЭТАП 16Б: ГЛАВНАЯ — KPI И КУРС ВАЛЮТ ============


# In-memory кэш курса валют ЦБ РФ. Обновляется не чаще раза в 6 часов.
# Структура: {"fetched_at": datetime, "data": {...}, "is_stale": bool}
_CBR_CACHE: dict = {"fetched_at": None, "data": None, "is_stale": False}
_CBR_TTL_SECONDS = 6 * 60 * 60  # 6 часов


def _can_view_kpi_metric(roles: list, metric: str) -> bool:
    """Решает, может ли пользователь с такими ролями видеть конкретную KPI плитку.

    Логика:
      - contracts_active, offers_active, offers_accepted_month_sum — продажные данные
        (director, zam, manager); accountant видит сумму, но не «в работе»
      - assemblies_today — производственные (director, master, engineer); скрыто
        у бухгалтера и менеджера

    Если у пользователя несколько ролей — он видит объединение.
    """
    if not roles:
        return False
    r = set(roles)
    if "director" in r:
        return True  # директор видит всё
    if metric == "assemblies_today":
        return bool(r & {"master", "engineer", "zam"})
    if metric == "offers_accepted_month_sum":
        return bool(r & {"zam", "manager", "accountant"})
    # contracts_active, offers_active
    return bool(r & {"zam", "manager", "engineer", "accountant"})


@require_auth
async def get_home_kpi_endpoint(request: web.Request) -> web.Response:
    """KPI блоки главной страницы — с фильтром видимости по ролям пользователя."""
    chat_id = request.get("chat_id")
    # Роли уже закэшированы в @require_auth-проверке; используем тот же источник
    roles = list(get_user_roles(chat_id)) if chat_id else []

    all_kpi = await db.get_home_kpi()

    # Применяем фильтр видимости — отдаём только те метрики которые роль может видеть
    visible = {}
    for key in ("contracts_active", "offers_active", "assemblies_today",
                "offers_accepted_month_sum"):
        if _can_view_kpi_metric(roles, key):
            visible[key] = all_kpi[key]

    return web.json_response({
        "kpi": visible,
        "user_roles": roles,
    })


async def _fetch_cbr_rates() -> dict | None:
    """Запрашивает у ЦБ РФ актуальные курсы USD/EUR/CNY.

    Возвращает словарь:
        {"date": "2026-05-14",
         "rates": {
            "USD": {"value": 91.85, "prev": 91.50, "diff": 0.35},
            "EUR": {...}, "CNY": {...}},
         "fetched_at": "2026-05-14T11:32:00"}
    Или None, если сеть недоступна.

    Используется только наш собственный мини-клиент aiohttp с таймаутом.
    """
    import aiohttp
    from datetime import datetime

    url = "https://www.cbr-xml-daily.ru/daily_json.js"
    try:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    logger.warning("CBR API: статус %s", resp.status)
                    return None
                payload = await resp.json(content_type=None)
    except Exception as e:
        logger.warning("CBR API: ошибка запроса: %s", e)
        return None

    valute = (payload or {}).get("Valute") or {}
    date_str = (payload or {}).get("Date") or ""
    # Date выглядит как "2026-05-14T11:30:00+03:00"
    date_short = date_str[:10] if date_str else ""

    out_rates = {}
    for code in ("USD", "EUR", "CNY"):
        v = valute.get(code)
        if not v:
            continue
        # ЦБ присылает "Value" и "Previous". Нормируем к 1 единице.
        nominal = float(v.get("Nominal") or 1)
        value_per_unit = float(v.get("Value") or 0) / nominal if nominal else 0
        prev_per_unit = float(v.get("Previous") or 0) / nominal if nominal else 0
        diff = value_per_unit - prev_per_unit
        out_rates[code] = {
            "value": round(value_per_unit, 4),
            "prev": round(prev_per_unit, 4),
            "diff": round(diff, 4),
        }

    if not out_rates:
        return None

    return {
        "date": date_short,
        "rates": out_rates,
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
    }


@require_auth
async def get_cbr_rates_endpoint(request: web.Request) -> web.Response:
    """Курс валют ЦБ РФ. Кэш 6 часов, при недоступности — последний известный с
    флагом is_stale=true.
    """
    from datetime import datetime

    now = datetime.now()
    cache_ok = (
        _CBR_CACHE.get("data") is not None
        and _CBR_CACHE.get("fetched_at") is not None
        and (now - _CBR_CACHE["fetched_at"]).total_seconds() < _CBR_TTL_SECONDS
    )

    if cache_ok:
        return web.json_response({**_CBR_CACHE["data"], "is_stale": False})

    # Кэш протух или пуст — обновим
    fresh = await _fetch_cbr_rates()
    if fresh:
        _CBR_CACHE["data"] = fresh
        _CBR_CACHE["fetched_at"] = now
        _CBR_CACHE["is_stale"] = False
        return web.json_response({**fresh, "is_stale": False})

    # Сеть упала — отдаём последний известный курс
    if _CBR_CACHE.get("data"):
        return web.json_response({**_CBR_CACHE["data"], "is_stale": True})

    return web.json_response(
        {"error": "cbr_unavailable", "message": "Курсы валют временно недоступны"},
        status=503,
    )


# ============ ЭТАП 16В: ЗАДАЧИ С ПЛАНЁРКИ ============


def _can_manage_tasks(roles: list) -> bool:
    """Право создавать/редактировать задачи: директор, зам, менеджер."""
    r = set(roles or [])
    return bool(r & {"director", "zam", "manager"})


def _serialize_task(t: dict) -> dict:
    """Превращает row из БД в JSON для фронта."""
    return {
        "id": t["id"],
        "title": t.get("title") or "",
        "description": t.get("description") or "",
        "assignee_id": t.get("assignee_id"),
        "assignee_name": t.get("assignee_short") or t.get("assignee_full") or "",
        "creator_chat_id": t.get("creator_chat_id"),
        "deadline": t.get("deadline"),
        "priority": t.get("priority") or "normal",
        "priority_label": db.TASK_PRIORITY_LABELS.get(t.get("priority") or "normal", "обычный"),
        "status": t.get("status") or "new",
        "status_label": db.TASK_STATUS_LABELS.get(t.get("status") or "new", "новая"),
        "source": t.get("source") or "",
        "created_at": t.get("created_at"),
        "updated_at": t.get("updated_at"),
        "done_at": t.get("done_at"),
    }


@require_auth
async def get_tasks_endpoint(request: web.Request) -> web.Response:
    """Список задач с фильтрами.

    Query params:
      - status: 'open' | 'new' | 'in_progress' | 'done' | 'cancelled'
      - assignee_id: int
      - mine: '1' = только мои (как создателя)
      - assigned_to_me: '1' = только назначенные мне
    """
    chat_id = request.get("chat_id")
    q = request.query

    filter_kwargs = {}

    status = q.get("status")
    if status in ("open", "new", "in_progress", "done", "cancelled"):
        filter_kwargs["status"] = status

    if q.get("mine") == "1":
        filter_kwargs["creator_chat_id"] = chat_id
    if q.get("assigned_to_me") == "1":
        emp = await db.get_employee_by_telegram_id(chat_id) if chat_id else None
        if emp:
            filter_kwargs["assignee_id"] = emp["id"]
        else:
            # Юзер не привязан к сотруднику — вернём пустой список
            return web.json_response({"tasks": [], "counts": await db.get_tasks_count_by_status()})

    assignee_id = q.get("assignee_id")
    if assignee_id:
        try:
            filter_kwargs["assignee_id"] = int(assignee_id)
        except (TypeError, ValueError):
            pass

    rows = await db.get_tasks(**filter_kwargs)
    counts = await db.get_tasks_count_by_status()
    return web.json_response({
        "tasks": [_serialize_task(r) for r in rows],
        "counts": counts,
    })


@require_auth
async def get_task_endpoint(request: web.Request) -> web.Response:
    """Один таск."""
    try:
        tid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_id"}, status=400)
    t = await db.get_task_by_id(tid)
    if not t or not t.get("is_active"):
        return web.json_response({"error": "not_found"}, status=404)
    return web.json_response(_serialize_task(t))


@require_auth
async def create_task_endpoint(request: web.Request) -> web.Response:
    """Создание задачи. Только директор/зам/менеджер."""
    chat_id = request.get("chat_id")
    roles = list(get_user_roles(chat_id)) if chat_id else []
    if not _can_manage_tasks(roles):
        return web.json_response(
            {"error": "forbidden", "message": "Создавать задачи может директор, зам или менеджер"},
            status=403,
        )

    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "bad_json"}, status=400)

    title = (data.get("title") or "").strip()
    if not title:
        return web.json_response({"error": "validation", "message": "Укажите название задачи"}, status=400)
    if len(title) > 200:
        return web.json_response({"error": "validation", "message": "Название слишком длинное (макс. 200)"}, status=400)

    description = (data.get("description") or "").strip() or None

    assignee_id = data.get("assignee_id")
    if assignee_id is not None:
        try:
            assignee_id = int(assignee_id)
            emp = await db.get_employee_by_id(assignee_id)
            if not emp or not emp.get("is_active"):
                return web.json_response({"error": "validation", "message": "Исполнитель не найден или деактивирован"}, status=400)
        except (TypeError, ValueError):
            return web.json_response({"error": "validation", "message": "Некорректный исполнитель"}, status=400)

    deadline = data.get("deadline")
    if deadline:
        if not _is_valid_date(deadline):
            return web.json_response({"error": "validation", "message": "Некорректный дедлайн"}, status=400)
    else:
        deadline = None

    priority = data.get("priority") or "normal"
    if priority not in ("low", "normal", "urgent"):
        priority = "normal"

    source = (data.get("source") or "").strip() or None

    new_id = await db.create_task(
        title=title,
        description=description,
        assignee_id=assignee_id,
        creator_chat_id=chat_id,
        deadline=deadline,
        priority=priority,
        source=source,
    )
    await db.log_action(chat_id, "create_task", "task", new_id, title)
    created = await db.get_task_by_id(new_id)
    return web.json_response(_serialize_task(created), status=201)


@require_auth
async def update_task_endpoint(request: web.Request) -> web.Response:
    """Обновление задачи.

    - Менять статус может: создатель, исполнитель, директор/зам/менеджер
    - Менять остальные поля: только директор/зам/менеджер (или создатель)
    """
    try:
        tid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_id"}, status=400)

    existing = await db.get_task_by_id(tid)
    if not existing or not existing.get("is_active"):
        return web.json_response({"error": "not_found"}, status=404)

    chat_id = request.get("chat_id")
    roles = list(get_user_roles(chat_id)) if chat_id else []
    can_manage = _can_manage_tasks(roles)

    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "bad_json"}, status=400)

    # Только менять статус — может исполнитель тоже
    is_only_status = (set(data.keys()) <= {"status"})
    emp = await db.get_employee_by_telegram_id(chat_id) if chat_id else None
    is_assignee = emp and existing.get("assignee_id") == emp["id"]
    is_creator = existing.get("creator_chat_id") == chat_id

    if not (can_manage or is_creator or (is_only_status and is_assignee)):
        return web.json_response(
            {"error": "forbidden", "message": "Нет прав на редактирование задачи"},
            status=403,
        )

    # Валидация полей
    fields = {}

    if "title" in data:
        t = (data["title"] or "").strip()
        if not t:
            return web.json_response({"error": "validation", "message": "Название не может быть пустым"}, status=400)
        if len(t) > 200:
            return web.json_response({"error": "validation", "message": "Название слишком длинное"}, status=400)
        fields["title"] = t

    if "description" in data:
        fields["description"] = (data["description"] or "").strip()

    if "assignee_id" in data:
        a = data["assignee_id"]
        if a is None or a == "":
            fields["assignee_id"] = None
        else:
            try:
                aid = int(a)
                e = await db.get_employee_by_id(aid)
                if not e or not e.get("is_active"):
                    return web.json_response({"error": "validation", "message": "Исполнитель не найден"}, status=400)
                fields["assignee_id"] = aid
                # При смене исполнителя — сбросим флаг уведомления чтобы отправилось новому
                if aid != existing.get("assignee_id"):
                    fields["_reset_notif_assigned"] = True
            except (TypeError, ValueError):
                return web.json_response({"error": "validation", "message": "Некорректный исполнитель"}, status=400)

    if "deadline" in data:
        d = data["deadline"]
        if d is None or d == "":
            fields["deadline"] = None
        elif not _is_valid_date(d):
            return web.json_response({"error": "validation", "message": "Некорректный дедлайн"}, status=400)
        else:
            fields["deadline"] = d
            # Сменили дедлайн — сбросим флаг уведомления
            if d != existing.get("deadline"):
                fields["_reset_notif_deadline"] = True

    if "priority" in data:
        p = data["priority"]
        if p not in ("low", "normal", "urgent"):
            return web.json_response({"error": "validation", "message": "Некорректный приоритет"}, status=400)
        fields["priority"] = p

    if "status" in data:
        s = data["status"]
        if s not in ("new", "in_progress", "done", "cancelled"):
            return web.json_response({"error": "validation", "message": "Некорректный статус"}, status=400)
        fields["status"] = s

    if "source" in data:
        fields["source"] = (data["source"] or "").strip()

    # Технические сбросы флагов уведомлений — делаем напрямую, не передаём в update_task
    reset_notif_assigned = fields.pop("_reset_notif_assigned", False)
    reset_notif_deadline = fields.pop("_reset_notif_deadline", False)

    if fields:
        await db.update_task(tid, **fields)

    if reset_notif_assigned:
        async with __import__("aiosqlite").connect(db.DB_PATH) as conn:
            await conn.execute("UPDATE tasks SET notif_assigned_sent = 0 WHERE id = ?", (tid,))
            await conn.commit()
    if reset_notif_deadline:
        async with __import__("aiosqlite").connect(db.DB_PATH) as conn:
            await conn.execute("UPDATE tasks SET notif_deadline_sent = 0 WHERE id = ?", (tid,))
            await conn.commit()

    await db.log_action(chat_id, "update_task", "task", tid, existing.get("title") or "")
    updated = await db.get_task_by_id(tid)
    return web.json_response(_serialize_task(updated))


@require_auth
async def delete_task_endpoint(request: web.Request) -> web.Response:
    """Soft-delete задачи. Только создатель или директор/зам/менеджер."""
    try:
        tid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_id"}, status=400)

    existing = await db.get_task_by_id(tid)
    if not existing or not existing.get("is_active"):
        return web.json_response({"error": "not_found"}, status=404)

    chat_id = request.get("chat_id")
    roles = list(get_user_roles(chat_id)) if chat_id else []
    is_creator = existing.get("creator_chat_id") == chat_id
    if not (_can_manage_tasks(roles) or is_creator):
        return web.json_response({"error": "forbidden"}, status=403)

    await db.set_task_active(tid, False)
    await db.log_action(chat_id, "delete_task", "task", tid, existing.get("title") or "")
    return web.json_response({"deleted": True})


@require_auth
async def get_my_tasks_endpoint(request: web.Request) -> web.Response:
    """Виджет «Мои задачи» на Главной.

    Возвращает до 5 ближайших открытых задач:
    - назначенные мне как исполнителю,
    - объединяем с поставленными мной (если я могу управлять).
    Сортировка такая же как в get_tasks (приоритет → дедлайн).
    """
    chat_id = request.get("chat_id")
    roles = list(get_user_roles(chat_id)) if chat_id else []

    tasks_by_id = {}

    # Задачи назначенные мне
    emp = await db.get_employee_by_telegram_id(chat_id) if chat_id else None
    if emp:
        my_assigned = await db.get_tasks(status="open", assignee_id=emp["id"], limit=20)
        for t in my_assigned:
            tasks_by_id[t["id"]] = t

    # Задачи поставленные мной (если умею ставить)
    if _can_manage_tasks(roles):
        my_created = await db.get_tasks(status="open", creator_chat_id=chat_id, limit=20)
        for t in my_created:
            tasks_by_id[t["id"]] = t

    # Сортируем (приоритет + дедлайн) и берём топ 5
    def _sort_key(t):
        pri = {"urgent": 0, "normal": 1, "low": 2}.get(t.get("priority") or "normal", 1)
        deadline = t.get("deadline") or "9999-99-99"
        return (pri, deadline)
    top = sorted(tasks_by_id.values(), key=_sort_key)[:5]

    return web.json_response({
        "tasks": [_serialize_task(t) for t in top],
        "total_open": len(tasks_by_id),
    })


# ============ ЭТАП 16Г: ГЛАВНАЯ — ОТГРУЗКИ И АКТИВНОСТИ ============


@require_auth
async def get_upcoming_shipments_endpoint(request: web.Request) -> web.Response:
    """Договоры с ближайшим сроком отгрузки (включая просроченные).

    Доступно всем кто видит продажи (director / zam / manager / engineer / accountant).
    Мастера не видят — для них пустой список.
    """
    chat_id = request.get("chat_id")
    roles = set(get_user_roles(chat_id)) if chat_id else set()
    if not (roles & {"director", "zam", "manager", "engineer", "accountant"}):
        return web.json_response({"contracts": []})

    rows = await db.get_upcoming_shipments(days_ahead=14, limit=10)

    today = date.today()
    result = []
    for c in rows:
        try:
            dd = date.fromisoformat(c.get("delivery_date") or "")
            diff = (dd - today).days
        except Exception:
            diff = None
        result.append({
            "id": c["id"],
            "number": c.get("number") or "",
            "contractor_name": c.get("contractor_name") or "",
            "manager_name": c.get("manager_name") or "",
            "status": c.get("status") or "",
            "status_label": CONTRACT_STATUS_LABELS.get(c.get("status") or "", "—"),
            "delivery_date": c.get("delivery_date"),
            "days_to_deadline": diff,
            "sum_amount": float(c.get("sum_amount") or 0),
        })

    return web.json_response({"contracts": result})


@require_auth
async def get_recent_activity_endpoint(request: web.Request) -> web.Response:
    """Лента последних событий (15 шт.)."""
    rows = await db.get_recent_activity(limit=15)
    result = []
    for r in rows:
        action = r.get("action") or ""
        meta = db.RECENT_ACTIVITY_ACTIONS.get(action)
        if not meta:
            continue
        icon, verb = meta
        who = r.get("who_short") or r.get("who_full") or "Кто-то"
        payload = r.get("payload") or ""
        # Собираем человекочитаемый текст
        if payload:
            text = f"{who} {verb} «{payload}»"
        else:
            text = f"{who} {verb}"
        result.append({
            "id": r["id"],
            "icon": icon,
            "text": text,
            "action": action,
            "entity": r.get("entity") or "",
            "entity_id": r.get("entity_id"),
            "created_at": r.get("created_at"),
        })
    return web.json_response({"activity": result})


# ============ ЭТАП 17: КАТЕГОРИИ ПРОДАЖНОЙ НОМЕНКЛАТУРЫ ============


def _serialize_category(c: dict) -> dict:
    return {
        "id": c["id"],
        "name": c.get("name") or "",
        "sort_order": c.get("sort_order") or 0,
        "products_count": c.get("products_count") or 0,
        "is_active": bool(c.get("is_active", 1)),
    }


@require_auth
async def get_sale_categories_endpoint(request: web.Request) -> web.Response:
    """Список активных категорий продажной номенклатуры."""
    rows = await db.get_sale_categories(only_active=True)
    return web.json_response({
        "categories": [_serialize_category(r) for r in rows],
    })


@require_auth
async def create_sale_category_endpoint(request: web.Request) -> web.Response:
    """Создание категории. Доступно: director / zam / manager."""
    chat_id = request.get("chat_id")
    roles = set(get_user_roles(chat_id)) if chat_id else set()
    if not (roles & {"director", "zam", "manager"}):
        return web.json_response({"error": "forbidden"}, status=403)

    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "bad_json"}, status=400)

    name = (data.get("name") or "").strip()
    if not name:
        return web.json_response({"error": "validation", "message": "Укажите название категории"}, status=400)
    if len(name) > 100:
        return web.json_response({"error": "validation", "message": "Слишком длинное название"}, status=400)

    sort_order = int(data.get("sort_order") or 0)

    try:
        new_id = await db.create_sale_category(name=name, sort_order=sort_order)
    except Exception as e:
        # уникальное имя
        if "UNIQUE" in str(e):
            return web.json_response({"error": "validation", "message": "Такая категория уже есть"}, status=400)
        raise

    await db.log_action(chat_id, "create_sale_category", "sale_category", new_id, name)
    cat = await db.get_sale_category_by_id(new_id)
    cat["products_count"] = 0
    return web.json_response(_serialize_category(cat), status=201)


@require_auth
async def update_sale_category_endpoint(request: web.Request) -> web.Response:
    chat_id = request.get("chat_id")
    roles = set(get_user_roles(chat_id)) if chat_id else set()
    if not (roles & {"director", "zam", "manager"}):
        return web.json_response({"error": "forbidden"}, status=403)
    try:
        cid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_id"}, status=400)
    existing = await db.get_sale_category_by_id(cid)
    if not existing:
        return web.json_response({"error": "not_found"}, status=404)

    try:
        data = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "bad_json"}, status=400)

    name = data.get("name")
    sort_order = data.get("sort_order")
    if name is not None:
        name = (name or "").strip()
        if not name:
            return web.json_response({"error": "validation", "message": "Название не может быть пустым"}, status=400)
        if len(name) > 100:
            return web.json_response({"error": "validation", "message": "Слишком длинное название"}, status=400)
    if sort_order is not None:
        try:
            sort_order = int(sort_order)
        except (TypeError, ValueError):
            sort_order = 0

    try:
        await db.update_sale_category(cid, name=name, sort_order=sort_order)
    except Exception as e:
        if "UNIQUE" in str(e):
            return web.json_response({"error": "validation", "message": "Такая категория уже есть"}, status=400)
        raise

    await db.log_action(chat_id, "update_sale_category", "sale_category", cid, name or existing.get("name") or "")
    rows = await db.get_sale_categories(only_active=False)
    cat = next((r for r in rows if r["id"] == cid), None)
    return web.json_response(_serialize_category(cat) if cat else {"id": cid})


@require_auth
async def delete_sale_category_endpoint(request: web.Request) -> web.Response:
    chat_id = request.get("chat_id")
    roles = set(get_user_roles(chat_id)) if chat_id else set()
    if not (roles & {"director", "zam", "manager"}):
        return web.json_response({"error": "forbidden"}, status=403)
    try:
        cid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_id"}, status=400)
    existing = await db.get_sale_category_by_id(cid)
    if not existing:
        return web.json_response({"error": "not_found"}, status=404)

    await db.set_sale_category_active(cid, False)
    await db.log_action(chat_id, "delete_sale_category", "sale_category", cid, existing.get("name") or "")
    return web.json_response({"deleted": True})


# ============ ЭТАП 17: WORD-ЭКСПОРТ КП ============


@require_auth
async def get_offer_docx(request: web.Request) -> web.Response:
    """Генерирует Word-документ КП и отдаёт inline."""
    try:
        oid = int(request.match_info.get("id", "0"))
    except (TypeError, ValueError):
        return web.json_response({"error": "bad_id"}, status=400)

    offer = await db.get_sale_offer_by_id(oid)
    if not offer or not offer.get("is_active"):
        return web.json_response({"error": "not_found"}, status=404)

    # Импорт лениво — модуль тяжёлый
    from . import docx_offers

    try:
        buf = await docx_offers.build_offer_docx(offer)
    except Exception as e:
        logger.exception("Atomus DOCX: ошибка генерации КП %s: %s", oid, e)
        return web.json_response({"error": "docx_error", "message": str(e)}, status=500)

    number = offer.get("number") or f"offer_{oid}"
    safe_num = "".join(c for c in number if c.isalnum() or c in "-_.")
    filename = f"КП_{safe_num}.docx"

    return web.Response(
        body=buf.getvalue(),
        headers={
            "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        },
    )


# ============ СОЗДАНИЕ APP ============


def create_aiohttp_app() -> web.Application:
    """Создаёт aiohttp-приложение со всеми роутами.

    Не запускает — возвращает Application, чтобы его можно было привязать к runner.
    """
    app = web.Application(middlewares=[cors_middleware, error_middleware])

    # ====== Базовые роуты ======
    app.router.add_get("/", root)
    app.router.add_get("/api/health", health)
    app.router.add_post("/api/auth/telegram", auth_telegram)
    app.router.add_post("/api/auth/code", auth_code)
    app.router.add_get("/api/me", get_me)
    app.router.add_get("/api/dashboard", get_dashboard)
    app.router.add_get("/api/history", get_history)
    app.router.add_get("/api/summary", get_summary)
    app.router.add_get("/api/employees", get_employees)
    app.router.add_get("/api/employees/active", get_employees_active)
    app.router.add_get("/api/models", get_models)
    app.router.add_post("/api/assemblies", create_assembly)

    # ====== ЭТАП 13: Управление сотрудниками через PWA ======
    app.router.add_post("/api/employees", create_employee_via_api)
    app.router.add_patch("/api/employees/{id}", update_employee_via_api)
    app.router.add_post("/api/employees/{id}/activate", set_employee_active_via_api)

    # ====== ЭТАП 13: Справочники ======
    app.router.add_get("/api/legal-entities", get_legal_entities)
    app.router.add_get("/api/roles", get_role_list)

    # ====== ЭТАП 13: Контрагенты ======
    app.router.add_get("/api/contractors", get_contractors)
    app.router.add_post("/api/contractors", create_contractor)
    app.router.add_get("/api/contractors/{id}", get_contractor)
    app.router.add_patch("/api/contractors/{id}", update_contractor)
    app.router.add_delete("/api/contractors/{id}", delete_contractor)

    # ====== ЭТАП 13: Договоры ======
    app.router.add_get("/api/contracts", get_contracts)
    app.router.add_post("/api/contracts", create_contract)
    app.router.add_get("/api/contracts/{id}", get_contract)
    app.router.add_patch("/api/contracts/{id}", update_contract)
    app.router.add_delete("/api/contracts/{id}", delete_contract)

    # ====== ЭТАП 14А: Продажная номенклатура ======
    app.router.add_get("/api/sale-products", get_sale_products)
    app.router.add_post("/api/sale-products", create_sale_product)
    app.router.add_get("/api/sale-products/{id}", get_sale_product)
    app.router.add_patch("/api/sale-products/{id}", update_sale_product)
    app.router.add_delete("/api/sale-products/{id}", delete_sale_product)
    app.router.add_get("/api/sale-product-units", get_sale_product_units)

    # ====== ЭТАП 14Б: КП (коммерческие предложения) ======
    app.router.add_get("/api/sale-offers", get_sale_offers)
    app.router.add_post("/api/sale-offers", create_sale_offer)
    app.router.add_get("/api/sale-offers/{id}", get_sale_offer)
    app.router.add_patch("/api/sale-offers/{id}", update_sale_offer)
    app.router.add_delete("/api/sale-offers/{id}", delete_sale_offer)
    app.router.add_post("/api/sale-offers/{id}/new-version", create_offer_version)
    app.router.add_get("/api/sale-offers/by-base/{base}/versions", get_offer_versions)
    app.router.add_get("/api/offer-statuses", get_offer_statuses)
    app.router.add_get("/api/sale-offers/{id}/pdf", get_offer_pdf)

    # ====== ЭТАП 15: Связь сборок с договорами ======
    app.router.add_get("/api/contracts-for-picker", get_contracts_for_picker)
    app.router.add_get("/api/contracts-with-progress", get_contracts_with_progress)

    # ====== ЭТАП 16Б: Главная страница — KPI и курс валют ======
    app.router.add_get("/api/home/kpi", get_home_kpi_endpoint)
    app.router.add_get("/api/home/cbr-rates", get_cbr_rates_endpoint)

    # ====== ЭТАП 16В: Задачи с планёрки ======
    app.router.add_get("/api/tasks", get_tasks_endpoint)
    app.router.add_post("/api/tasks", create_task_endpoint)
    app.router.add_get("/api/tasks/{id}", get_task_endpoint)
    app.router.add_patch("/api/tasks/{id}", update_task_endpoint)
    app.router.add_delete("/api/tasks/{id}", delete_task_endpoint)
    app.router.add_get("/api/home/my-tasks", get_my_tasks_endpoint)

    # ====== ЭТАП 16Г: Главная — отгрузки и активности ======
    app.router.add_get("/api/home/upcoming-shipments", get_upcoming_shipments_endpoint)
    app.router.add_get("/api/home/recent-activity", get_recent_activity_endpoint)

    # ====== ЭТАП 17: Категории продажной номенклатуры ======
    app.router.add_get("/api/sale-categories", get_sale_categories_endpoint)
    app.router.add_post("/api/sale-categories", create_sale_category_endpoint)
    app.router.add_patch("/api/sale-categories/{id}", update_sale_category_endpoint)
    app.router.add_delete("/api/sale-categories/{id}", delete_sale_category_endpoint)

    # ====== ЭТАП 17: Word-экспорт КП ======
    app.router.add_get("/api/sale-offers/{id}/docx", get_offer_docx)

    return app


async def start_api_server(port: int = 8080):
    """Запускает HTTP-сервер на указанном порту в фоне.

    Используется из app.setup() — рядом с регистрацией хендлеров бота.
    """
    app = create_aiohttp_app()
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, host="0.0.0.0", port=port)
    await site.start()
    logger.info("Atomus API: HTTP-сервер слушает на 0.0.0.0:%d", port)
    return runner
