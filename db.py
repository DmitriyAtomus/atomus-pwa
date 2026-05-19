"""База данных модуля Atomus Production.

SQLite + aiosqlite (асинхронный доступ).
Файл БД: {DATA_DIR}/atomus.sqlite

ВАЖНО: aiosqlite-соединения открываются через `async with aiosqlite.connect(...)` —
это чистый паттерн, без промежуточной функции get_conn(). Так избегается баг
"threads can only be started once" при асинхронных контекстах.
"""
import hashlib
import hmac
import logging
import secrets
from datetime import date, datetime, timedelta
from typing import Any
import aiosqlite

from .config import DB_PATH

logger = logging.getLogger("atomus.db")


# ============ ЭТАП 29: РЕЕСТР ПРАВ И БАЗОВЫЕ УРОВНИ ДОСТУПА ============

# Реестр всех известных permission-ключей.
# Формат: (key, label, group). group задаёт порядок и группировку в UI.
PERMISSIONS_REGISTRY: list[tuple[str, str, str]] = [
    # Главная
    ("home.view_activity",      "Видеть «Последние действия»",                      "Главная"),
    ("home.view_finance_kpi",   "Видеть финансовые KPI",                            "Главная"),
    # Производство
    ("production.view",         "Видеть Производство",                              "Производство"),
    ("production.create",       "Создавать сборки/работы",                          "Производство"),
    ("production.manage",       "Редактировать/удалять сборки",                     "Производство"),
    # Продажи
    ("sales.view",              "Видеть Продажи (договоры, КП, контрагенты)",        "Продажи"),
    ("sales.create",            "Создавать договоры и КП",                          "Продажи"),
    ("sales.manage",            "Управлять ценами, редактировать/удалять",          "Продажи"),
    # Склад
    ("warehouse.view",          "Видеть Склад",                                     "Склад"),
    ("warehouse.ship",          "Отгружать/принимать",                              "Склад"),
    # Логистика
    ("logistics.view",          "Видеть Логистику",                                 "Логистика"),
    ("logistics.manage",        "Управлять перевозками",                            "Логистика"),
    # Снабжение
    ("supply.view",             "Видеть Снабжение",                                 "Снабжение"),
    ("supply.manage",           "Управлять закупками",                              "Снабжение"),
    # Доработки
    ("defects.view",            "Видеть Доработки",                                 "Доработки"),
    ("defects.create",          "Создавать замечания",                              "Доработки"),
    ("defects.resolve",         "Решать замечания",                                 "Доработки"),
    # Задачи
    ("tasks.view_all",          "Видеть задачи всех (по умолчанию — только свои)",  "Задачи"),
    ("tasks.create_for_others", "Создавать задачи другим",                          "Задачи"),
    # Кадры
    ("hr.view_vacations",       "Видеть График отпусков",                           "Кадры"),
    ("hr.create_vacations",     "Создавать отпуска",                                "Кадры"),
    ("hr.manage_employees",     "Управлять сотрудниками",                           "Кадры"),
    ("hr.manage_positions",     "Управлять справочником должностей",                "Кадры"),
    ("hr.manage_access",        "Настраивать уровни доступа",                       "Кадры"),
]

ALL_PERMISSION_KEYS = {p[0] for p in PERMISSIONS_REGISTRY}

# Базовые системные уровни доступа. Создаются при первом запуске.
# Директор может их редактировать, но не удалять.
BASE_ACCESS_LEVELS: list[dict] = [
    {
        "name": "Директор",
        "sort_order": 10,
        "is_system": 1,
        "permissions": sorted(ALL_PERMISSION_KEYS),  # все
    },
    {
        "name": "Заместитель директора",
        "sort_order": 20,
        "is_system": 1,
        "permissions": sorted(ALL_PERMISSION_KEYS - {"hr.manage_access"}),
    },
    {
        "name": "Менеджер по продажам",
        "sort_order": 30,
        "is_system": 1,
        "permissions": [
            "home.view_activity",
            "sales.view", "sales.create",
            "warehouse.view",
            "logistics.view",
            "supply.view",
            "production.view",
            "defects.view", "defects.create",
            "tasks.view_all", "tasks.create_for_others",
        ],
    },
    {
        "name": "Бухгалтер",
        "sort_order": 40,
        "is_system": 1,
        "permissions": [
            "home.view_finance_kpi",
            "sales.view",
            "defects.view",
        ],
    },
    {
        "name": "Работник производства",
        "sort_order": 50,
        "is_system": 1,
        "permissions": [
            "production.view", "production.create",
            "warehouse.view",
            "defects.view", "defects.create",
        ],
    },
]


def derive_legacy_roles(perms: set[str]) -> set[str]:
    """Из набора permissions выводит набор legacy-ролей для обратной совместимости.

    Старый код проверяет 'director' in roles / 'master' in roles / @require_director.
    Здесь генерируем эти строки на лету, чтобы старый код продолжал работать.
    """
    roles = set()
    if "hr.manage_access" in perms:
        roles.add("director")
    if "sales.manage" in perms:
        roles.add("zam")
    if "sales.create" in perms:
        roles.add("manager")
    if "home.view_finance_kpi" in perms:
        roles.add("accountant")
    if "production.create" in perms:
        roles.add("master")
    return roles


# ============ ИНИЦИАЛИЗАЦИЯ СХЕМЫ ============

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS directions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL,
    subtitle     TEXT,
    icon         TEXT,
    sort_order   INTEGER DEFAULT 0,
    is_active    INTEGER DEFAULT 1,
    created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    direction_id  INTEGER NOT NULL REFERENCES directions(id),
    code          TEXT NOT NULL,
    name          TEXT NOT NULL,
    icon          TEXT,
    sort_order    INTEGER DEFAULT 0,
    is_active     INTEGER DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now')),
    UNIQUE(direction_id, code)
);

CREATE TABLE IF NOT EXISTS subgroups (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    direction_id  INTEGER NOT NULL REFERENCES directions(id),
    code          TEXT NOT NULL,
    name          TEXT NOT NULL,
    sort_order    INTEGER DEFAULT 0,
    is_active     INTEGER DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now')),
    UNIQUE(direction_id, code)
);

CREATE TABLE IF NOT EXISTS models (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    direction_id    INTEGER NOT NULL REFERENCES directions(id),
    category_id     INTEGER REFERENCES categories(id),
    subgroup_id     INTEGER REFERENCES subgroups(id),
    article         TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    extra           TEXT,
    description     TEXT,
    exec_mode       TEXT DEFAULT 'none',
    exec_fixed      TEXT,
    exec_label_st   TEXT DEFAULT 'Стандарт',
    exec_label_ne   TEXT DEFAULT 'Нерж. AISI',
    needs_ip        INTEGER DEFAULT 0,
    work_type       TEXT DEFAULT 'full_build',
    sort_order      INTEGER DEFAULT 0,
    is_active       INTEGER DEFAULT 1,
    search_text     TEXT DEFAULT '',
    created_at      TEXT DEFAULT (datetime('now'))
);
-- индекс idx_models_search создаётся отдельно после миграции

CREATE TABLE IF NOT EXISTS employees (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name       TEXT NOT NULL,
    short_name      TEXT,
    position        TEXT,
    phone           TEXT,
    email           TEXT,
    tab_number      TEXT,
    telegram_id     INTEGER,
    roles           TEXT DEFAULT '',
    work_start      TEXT DEFAULT '08:00',
    work_end        TEXT DEFAULT '17:00',
    work_days       TEXT DEFAULT '1,2,3,4,5',
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assemblies (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id        INTEGER REFERENCES models(id),         -- ЭТАП 23: nullable (для не-сборок)
    execution       TEXT,
    ip_class        TEXT,
    quantity        INTEGER NOT NULL DEFAULT 1,
    assembly_date   TEXT NOT NULL,
    comment         TEXT,
    contract_id     INTEGER REFERENCES contracts(id),   -- ЭТАП 15: связь с договором (NULL = на склад)
    status          TEXT NOT NULL DEFAULT 'in_progress', -- ЭТАП 18: in_progress | ready | shipped | written_off
    public_token    TEXT UNIQUE,                         -- ЭТАП 21: токен для публичной страницы (QR)
    -- ЭТАП 23: универсальные «работы»
    work_type       TEXT NOT NULL DEFAULT 'assembly',    -- assembly | repair | commissioning | installation | diagnostics | design | maintenance | other
    description     TEXT,                                -- описание работы (для не-сборок обязательно)
    location        TEXT,                                -- адрес/локация (для выездных)
    hours_spent     REAL,                                -- часы работы (опционально)
    created_by_chat_id INTEGER,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    updated_by_chat_id INTEGER,
    is_active       INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_assemblies_date ON assemblies(assembly_date);
CREATE INDEX IF NOT EXISTS idx_assemblies_model ON assemblies(model_id);
CREATE INDEX IF NOT EXISTS idx_assemblies_active ON assemblies(is_active);
-- idx_assemblies_contract / status / public_token / work_type — создаются в init_db() ПОСЛЕ миграции

CREATE TABLE IF NOT EXISTS assembly_workers (
    assembly_id  INTEGER NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
    employee_id  INTEGER NOT NULL REFERENCES employees(id),
    PRIMARY KEY (assembly_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_aw_employee ON assembly_workers(employee_id);

CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id      INTEGER,
    action       TEXT NOT NULL,
    entity       TEXT,
    entity_id    INTEGER,
    payload      TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_chat ON audit_log(chat_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

CREATE TABLE IF NOT EXISTS calendar_holidays (
    date         TEXT PRIMARY KEY,
    description  TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
);

-- ============ КОНТРАГЕНТЫ (Этап 13) ============
-- Клиенты, с которыми заключаем договоры.
-- Минимум полей — детальные реквизиты ведутся в 1С.
CREATE TABLE IF NOT EXISTS contractors (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    contractor_type TEXT NOT NULL DEFAULT 'legal',  -- 'legal' / 'private'
    name          TEXT NOT NULL,             -- название организации или ФИО
    inn           TEXT,                       -- ИНН (необязательно)
    phone         TEXT,                       -- основной телефон
    contact_person TEXT,                      -- контактное лицо (для юрлиц)
    address       TEXT,                       -- адрес (свободной строкой)
    comment       TEXT,                       -- внутренний комментарий для своих
    created_by_chat_id INTEGER,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now')),
    updated_by_chat_id INTEGER,
    is_active     INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_contractors_name ON contractors(name);
CREATE INDEX IF NOT EXISTS idx_contractors_inn ON contractors(inn);
CREATE INDEX IF NOT EXISTS idx_contractors_active ON contractors(is_active);

-- ============ ДОГОВОРЫ (Этап 13) ============
CREATE TABLE IF NOT EXISTS contracts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    number            TEXT NOT NULL,                       -- номер договора (как у Дмитрия в 1С)
    sign_date         TEXT NOT NULL,                       -- дата подписания YYYY-MM-DD
    contractor_id     INTEGER NOT NULL REFERENCES contractors(id),
    contract_type     TEXT NOT NULL DEFAULT 'supply',      -- 'supply' / 'supply_install'
    status            TEXT NOT NULL DEFAULT 'production',  -- 4 статуса
    legal_entity      TEXT NOT NULL DEFAULT 'ooo_atomus',  -- ooo_atomus / ooo_td_atomus
    sum_amount        REAL,                                -- общая сумма (если указана)
    delivery_date     TEXT,                                -- срок отгрузки YYYY-MM-DD
    delivery_address  TEXT,                                -- адрес доставки
    manager_id        INTEGER REFERENCES employees(id),    -- ведёт менеджер
    comment           TEXT,                                -- комментарий
    public_token      TEXT UNIQUE,                         -- ЭТАП 21: токен для публичной страницы (QR)
    created_by_chat_id INTEGER,
    created_at        TEXT DEFAULT (datetime('now')),
    updated_at        TEXT DEFAULT (datetime('now')),
    updated_by_chat_id INTEGER,
    is_active         INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_contracts_number ON contracts(number);
CREATE INDEX IF NOT EXISTS idx_contracts_contractor ON contracts(contractor_id);
CREATE INDEX IF NOT EXISTS idx_contracts_manager ON contracts(manager_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_active ON contracts(is_active);

-- ============ ПРОДАЖНАЯ НОМЕНКЛАТУРА (Этап 14А) ============
-- Отдельный каталог для КП. Названия для клиентов («Увлажнитель промышленный...»),
-- описание, базовые цены. Связь со сборкой опциональная.
CREATE TABLE IF NOT EXISTS sale_products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,                     -- название для клиента
    description   TEXT,                              -- описание (попадёт в PDF КП)
    product_type  TEXT NOT NULL DEFAULT 'goods',     -- 'goods' / 'service'
    base_price    REAL,                              -- базовая цена ₽ (опционально, для услуг может быть NULL)
    unit          TEXT NOT NULL DEFAULT 'шт.',       -- ед.изм.: 'шт.' / 'усл.' / 'компл.' / 'м' / 'м²' / 'м³'
    category_id   INTEGER REFERENCES sale_categories(id),  -- ЭТАП 17: категория (опц.)
    sort_order    INTEGER DEFAULT 0,
    is_active     INTEGER DEFAULT 1,
    created_by_chat_id INTEGER,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now')),
    updated_by_chat_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sale_products_name ON sale_products(name);
CREATE INDEX IF NOT EXISTS idx_sale_products_active ON sale_products(is_active);

-- ============ ЭТАП 17: КАТЕГОРИИ ПРОДАЖНОЙ НОМЕНКЛАТУРЫ ============
CREATE TABLE IF NOT EXISTS sale_categories (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    sort_order    INTEGER DEFAULT 0,
    is_active     INTEGER DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sale_categories_active ON sale_categories(is_active);

-- Связи продажной позиции со сборочной номенклатурой (N:N, обычно 1:1 или N:1).
-- Один продажный продукт может быть связан с несколькими сборками.
-- Связь опциональная — для услуг (шеф-монтаж) её просто нет.
CREATE TABLE IF NOT EXISTS sale_product_models (
    sale_product_id  INTEGER NOT NULL REFERENCES sale_products(id) ON DELETE CASCADE,
    model_id         INTEGER NOT NULL REFERENCES models(id),
    qty_per_product  INTEGER NOT NULL DEFAULT 1,     -- сколько сборок на одну продажу (обычно 1)
    PRIMARY KEY (sale_product_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_spm_model ON sale_product_models(model_id);

-- ============ КОММЕРЧЕСКИЕ ПРЕДЛОЖЕНИЯ — КП (Этап 14Б) ============
-- Версионирование через base_number: все версии одного КП имеют одинаковый base_number,
-- но разный version. В списке показываем только МАКСИМАЛЬНУЮ версию каждого base_number.
CREATE TABLE IF NOT EXISTS sale_offers (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    number            TEXT NOT NULL,                       -- полный номер: КП-018-ПД-12.05.v3
    base_number       TEXT NOT NULL,                       -- база без версии: КП-018-ПД-12.05
    version           INTEGER NOT NULL DEFAULT 1,          -- 1, 2, 3...
    seq_number        INTEGER NOT NULL,                    -- порядковый номер у менеджера (018)
    manager_id        INTEGER NOT NULL REFERENCES employees(id),   -- обязателен
    contractor_id     INTEGER NOT NULL REFERENCES contractors(id), -- обязателен
    legal_entity      TEXT NOT NULL DEFAULT 'ooo_atomus',  -- ooo_atomus / ooo_td_atomus
    status            TEXT NOT NULL DEFAULT 'draft',       -- draft/sent/accepted/rejected
    valid_until       TEXT,                                -- срок действия КП (YYYY-MM-DD) — авторасчёт от created_at + duration
    valid_duration_value  INTEGER,                         -- ЭТАП 16А: число дней/недель/месяцев действия КП
    valid_duration_unit   TEXT DEFAULT 'days',             -- ЭТАП 16А: 'days' | 'weeks' | 'months'
    production_term   TEXT,                                -- срок изготовления (свободный текст, legacy)
    production_days   INTEGER,                             -- ЭТАП 16А: срок изготовления в рабочих днях (новый формат)
    payment_terms     TEXT,                                -- условия оплаты (свободный текст)
    delivery_terms    TEXT,                                -- условия доставки (свободный текст)
    comment_internal  TEXT,                                -- внутренний (не в PDF)
    comment_client    TEXT,                                -- клиенту (в PDF)
    total_sum         REAL,                                -- общая сумма (сумма всех позиций с учётом скидок)
    created_by_chat_id INTEGER,
    created_at        TEXT DEFAULT (datetime('now')),
    updated_at        TEXT DEFAULT (datetime('now')),
    updated_by_chat_id INTEGER,
    is_active         INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_offers_base ON sale_offers(base_number);
CREATE INDEX IF NOT EXISTS idx_offers_manager ON sale_offers(manager_id);
CREATE INDEX IF NOT EXISTS idx_offers_contractor ON sale_offers(contractor_id);
CREATE INDEX IF NOT EXISTS idx_offers_status ON sale_offers(status);
CREATE INDEX IF NOT EXISTS idx_offers_active ON sale_offers(is_active);

-- Позиции КП. К одному КП — много позиций.
CREATE TABLE IF NOT EXISTS sale_offer_items (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    offer_id          INTEGER NOT NULL REFERENCES sale_offers(id) ON DELETE CASCADE,
    sale_product_id   INTEGER REFERENCES sale_products(id),  -- может быть NULL если позиция удалена из каталога
    sort_order        INTEGER NOT NULL DEFAULT 0,
    name              TEXT NOT NULL,                         -- название (копируется из sale_products на момент создания)
    description       TEXT,                                  -- описание (можно править отдельно)
    unit              TEXT NOT NULL DEFAULT 'шт.',
    qty               REAL NOT NULL DEFAULT 1,
    price             REAL NOT NULL DEFAULT 0,               -- цена за единицу
    discount_pct      REAL NOT NULL DEFAULT 0,               -- скидка в процентах (0-100)
    line_total        REAL NOT NULL DEFAULT 0                -- qty * price * (1 - discount_pct/100)
);

CREATE INDEX IF NOT EXISTS idx_offer_items_offer ON sale_offer_items(offer_id);

-- ============ ЭТАП 16В: ЗАДАЧИ С ПЛАНЁРКИ ============
-- Универсальные задачи: ставит руководитель, отвечает сотрудник.
-- Без жёсткой связи с договорами/КП (это будет в Этапе 16Г).
CREATE TABLE IF NOT EXISTS tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,                         -- короткое название (до 200)
    description     TEXT,                                  -- подробности (опц.)
    assignee_id     INTEGER REFERENCES employees(id),      -- ответственный (1 сотрудник)
    creator_chat_id INTEGER,                               -- кто поставил (telegram_id)
    deadline        TEXT,                                  -- дедлайн YYYY-MM-DD (опц.)
    priority        TEXT NOT NULL DEFAULT 'normal',        -- low / normal / urgent
    status          TEXT NOT NULL DEFAULT 'new',           -- new / in_progress / done / cancelled
    source          TEXT,                                  -- свободный тег: «Планёрка 14.05.2026», «Звонок клиента»
    contract_id     INTEGER REFERENCES contracts(id),      -- ЭТАП 16В-2: привязка к договору (опц.)
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    done_at         TEXT,                                  -- когда закрыли (заполняется автоматически)
    is_active       INTEGER DEFAULT 1,
    -- Уведомления — флаги чтобы не слать повторно
    notif_assigned_sent     INTEGER DEFAULT 0,             -- уведомление о назначении
    notif_deadline_sent     INTEGER DEFAULT 0              -- напоминание о дедлайне (за день)
);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks(is_active);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_chat_id);
-- ЭТАП 16В-2: индекс idx_tasks_contract создаётся в миграционном блоке init_db()
-- ПОСЛЕ ALTER TABLE ADD COLUMN, иначе на существующей БД (где колонки ещё нет)
-- этот скрипт упадёт с "no such column: contract_id".

-- ============ ЭТАП 18: СКЛАД (журнал движений сборок) ============
-- Один центральный склад, на котором лежат только assemblies (готовые сборки).
-- Остаток вычисляется на лету из журнала движений:
--   остаток = SUM(qty for 'in') − SUM(qty for 'out') − SUM(qty for 'write_off')
-- Отдельной таблицы текущих остатков нет — журнал единственный источник правды.
CREATE TABLE IF NOT EXISTS warehouse_movements (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    assembly_id        INTEGER NOT NULL REFERENCES assemblies(id),
    direction          TEXT NOT NULL,                   -- 'in' | 'out' | 'write_off'
    qty                INTEGER NOT NULL DEFAULT 1,      -- обычно 1, заложено на будущее
    contract_id        INTEGER REFERENCES contracts(id),-- для расхода по договору (опц.)
    reason             TEXT,                            -- свободный текст (брак, бой, и т.п.)
    comment            TEXT,
    created_at         TEXT DEFAULT (datetime('now')),
    created_by_chat_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_whmov_assembly  ON warehouse_movements(assembly_id);
CREATE INDEX IF NOT EXISTS idx_whmov_direction ON warehouse_movements(direction);
CREATE INDEX IF NOT EXISTS idx_whmov_contract  ON warehouse_movements(contract_id);
CREATE INDEX IF NOT EXISTS idx_whmov_date      ON warehouse_movements(created_at);

-- ============ ЭТАП 19: СНАБЖЕНИЕ ============
-- Каталог "что закупаем", поставщики, заявки, заказы, приёмки.
-- Каталог свободной формы (без BOM к моделям сборок — это для будущего).
-- Остатки комплектующих не ведём — только журнал событий.

-- Поставщики (по образцу contractors)
CREATE TABLE IF NOT EXISTS suppliers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    inn             TEXT,
    contact_person  TEXT,
    phone           TEXT,
    email           TEXT,
    comment         TEXT,
    created_by_chat_id INTEGER,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    updated_by_chat_id INTEGER,
    is_active       INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(is_active);
CREATE INDEX IF NOT EXISTS idx_suppliers_name   ON suppliers(name);

-- Каталог закупаемой номенклатуры
-- kind: 'material' — комплектующее для сборки / 'product' — товар для перепродажи
CREATE TABLE IF NOT EXISTS supply_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'material',  -- 'material' | 'product'
    unit            TEXT DEFAULT 'шт.',                -- ед. изм.
    comment         TEXT,
    created_by_chat_id INTEGER,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    is_active       INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_supply_items_active ON supply_items(is_active);
CREATE INDEX IF NOT EXISTS idx_supply_items_kind   ON supply_items(kind);

-- Заявки на закупку
-- status: 'new' (новая) | 'ordered' (попала в заказ) | 'received' (приехала) | 'cancelled' (отменена)
CREATE TABLE IF NOT EXISTS supply_requests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id         INTEGER NOT NULL REFERENCES supply_items(id),
    qty             REAL NOT NULL DEFAULT 1,
    needed_by       TEXT,                              -- YYYY-MM-DD, опц.
    contract_id     INTEGER REFERENCES contracts(id),  -- опц. привязка к договору
    status          TEXT NOT NULL DEFAULT 'new',
    comment         TEXT,
    created_by_chat_id INTEGER,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    is_active       INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_supply_req_status   ON supply_requests(status);
CREATE INDEX IF NOT EXISTS idx_supply_req_item     ON supply_requests(item_id);
CREATE INDEX IF NOT EXISTS idx_supply_req_contract ON supply_requests(contract_id);
CREATE INDEX IF NOT EXISTS idx_supply_req_active   ON supply_requests(is_active);

-- Заказы поставщикам
-- status: 'draft' (черновик) | 'sent' (отправлен) | 'received' (полностью принят) | 'partial' (частично) | 'cancelled'
CREATE TABLE IF NOT EXISTS supply_orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id     INTEGER NOT NULL REFERENCES suppliers(id),
    status          TEXT NOT NULL DEFAULT 'draft',
    expected_date   TEXT,                              -- YYYY-MM-DD когда ожидаем приёмку
    comment         TEXT,
    created_by_chat_id INTEGER,
    created_at      TEXT DEFAULT (datetime('now')),
    sent_at         TEXT,                              -- когда отправили (status='sent')
    updated_at      TEXT DEFAULT (datetime('now')),
    is_active       INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_supply_ord_status   ON supply_orders(status);
CREATE INDEX IF NOT EXISTS idx_supply_ord_supplier ON supply_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supply_ord_active   ON supply_orders(is_active);

-- Позиции в заказе. Одна позиция = одно наименование.
-- request_id опционален — заказ может включать позицию "на пустом месте" без заявки.
-- Если request_id указан — этот заказ закрывает заявку (после приёмки status заявки → 'received').
CREATE TABLE IF NOT EXISTS supply_order_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id        INTEGER NOT NULL REFERENCES supply_orders(id),
    item_id         INTEGER NOT NULL REFERENCES supply_items(id),
    qty             REAL NOT NULL DEFAULT 1,
    price           REAL,                              -- цена за единицу, опц.
    request_id      INTEGER REFERENCES supply_requests(id),  -- если из заявки
    received_qty    REAL DEFAULT 0,                    -- сколько фактически принято
    comment         TEXT
);
CREATE INDEX IF NOT EXISTS idx_supply_oi_order   ON supply_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_supply_oi_item    ON supply_order_items(item_id);
CREATE INDEX IF NOT EXISTS idx_supply_oi_request ON supply_order_items(request_id);

-- Приёмки. Одна приёмка = акт приёма по конкретному заказу за конкретную дату.
-- Подробности что и сколько принято — в supply_receipt_items.
CREATE TABLE IF NOT EXISTS supply_receipts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id        INTEGER NOT NULL REFERENCES supply_orders(id),
    received_date   TEXT NOT NULL,                     -- YYYY-MM-DD когда фактически
    comment         TEXT,
    received_by_chat_id INTEGER,
    created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supply_rec_order ON supply_receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_supply_rec_date  ON supply_receipts(received_date);

-- Что именно принято в рамках одной приёмки
CREATE TABLE IF NOT EXISTS supply_receipt_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id      INTEGER NOT NULL REFERENCES supply_receipts(id),
    order_item_id   INTEGER NOT NULL REFERENCES supply_order_items(id),
    qty             REAL NOT NULL DEFAULT 1,           -- сколько принято в эту приёмку
    comment         TEXT
);
CREATE INDEX IF NOT EXISTS idx_supply_ri_receipt    ON supply_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_supply_ri_order_item ON supply_receipt_items(order_item_id);

-- ============ ЭТАП 20: КАДРЫ — ОТПУСКА ============
-- Минимальная запись: сотрудник + даты. Ведёт только бухгалтер.
CREATE TABLE IF NOT EXISTS vacations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id     INTEGER NOT NULL REFERENCES employees(id),
    start_date      TEXT NOT NULL,             -- YYYY-MM-DD
    end_date        TEXT NOT NULL,             -- YYYY-MM-DD
    comment         TEXT,
    created_by_chat_id INTEGER,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    is_active       INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_vacations_employee ON vacations(employee_id);
CREATE INDEX IF NOT EXISTS idx_vacations_start    ON vacations(start_date);
CREATE INDEX IF NOT EXISTS idx_vacations_end      ON vacations(end_date);
CREATE INDEX IF NOT EXISTS idx_vacations_active   ON vacations(is_active);

-- ============ ЭТАП 22: ДОРАБОТКИ — ЗАМЕЧАНИЯ С ПОЛЯ ============
-- Отправляются через публичную страницу (по QR со сборки/договора).
-- Может оставить любой, опционально указав имя/телефон.
CREATE TABLE IF NOT EXISTS defect_reports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    assembly_id     INTEGER REFERENCES assemblies(id),    -- к какой сборке (если со сборки)
    contract_id     INTEGER REFERENCES contracts(id),     -- к какому договору (может быть из QR договора или авто-из сборки)
    type            TEXT NOT NULL DEFAULT 'defect',       -- defect | issue | improvement | question
    description     TEXT NOT NULL,                        -- сам текст замечания
    author_name     TEXT,                                 -- имя отправителя (опц.)
    author_phone    TEXT,                                 -- телефон (опц.)
    location        TEXT,                                 -- где найдено (опц.)
    status          TEXT NOT NULL DEFAULT 'new',          -- new | in_progress | resolved | rejected
    resolution_note TEXT,                                 -- комментарий при resolved/rejected
    assignee_id     INTEGER REFERENCES employees(id),     -- ответственный (если назначен)
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    updated_by_chat_id INTEGER,
    is_active       INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_defects_assembly ON defect_reports(assembly_id);
CREATE INDEX IF NOT EXISTS idx_defects_contract ON defect_reports(contract_id);
CREATE INDEX IF NOT EXISTS idx_defects_status   ON defect_reports(status);
CREATE INDEX IF NOT EXISTS idx_defects_type     ON defect_reports(type);
CREATE INDEX IF NOT EXISTS idx_defects_created  ON defect_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_defects_active   ON defect_reports(is_active);

-- Фото к замечанию (до 5 на запись)
CREATE TABLE IF NOT EXISTS defect_report_photos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    defect_id       INTEGER NOT NULL REFERENCES defect_reports(id) ON DELETE CASCADE,
    file_path       TEXT NOT NULL,                        -- путь относительно UPLOADS_DIR
    file_size       INTEGER,
    content_type    TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_defect_photos_defect ON defect_report_photos(defect_id);
"""


async def init_db():
    """Создаёт схему БД, если её ещё нет. Идемпотентно.

    Также выполняет лёгкие миграции — добавляет недостающие столбцы
    в существующую БД (если бот обновлялся со старой версии).

    Порядок важный:
    1. Создаём базовую схему (без индекса по search_text)
    2. Проверяем наличие столбца search_text — добавляем если нет
    3. Создаём индекс на search_text (когда столбец гарантированно есть)
    4. Заполняем search_text для существующих моделей
    """
    # Шаг 1: базовая схема
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.executescript(SCHEMA_SQL)
        await conn.commit()

    # Шаги 2-4: миграция search_text
    async with aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row

        # Шаг 2: добавить столбец, если его нет
        cur = await conn.execute("PRAGMA table_info(models)")
        rows = await cur.fetchall()
        cols = [r[1] for r in rows]
        if "search_text" not in cols:
            logger.info("Atomus DB: добавляю поле search_text в таблицу models")
            await conn.execute("ALTER TABLE models ADD COLUMN search_text TEXT DEFAULT ''")
            await conn.commit()

        # Шаг 3: создаём индекс (теперь столбец точно есть)
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_models_search ON models(search_text)")
        await conn.commit()

        # Шаг 4: заполняем search_text для моделей, у которых он пуст
        cur = await conn.execute(
            "SELECT id, name, article, description, extra FROM models "
            "WHERE search_text = '' OR search_text IS NULL"
        )
        rows = await cur.fetchall()
        if rows:
            logger.info("Atomus DB: заполняю search_text для %d моделей", len(rows))
            for r in rows:
                parts = []
                for field in ("name", "article", "description", "extra"):
                    v = r[field]
                    if v:
                        parts.append(str(v).lower())
                search_text = " ".join(parts)
                await conn.execute(
                    "UPDATE models SET search_text = ? WHERE id = ?",
                    (search_text, r["id"]),
                )
            await conn.commit()

    # ============ ЭТАП 15: миграция contract_id в assemblies ============
    async with aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("PRAGMA table_info(assemblies)")
        rows = await cur.fetchall()
        cols = [r[1] for r in rows]
        if "contract_id" not in cols:
            logger.info("Atomus DB: добавляю поле contract_id в таблицу assemblies (Этап 15)")
            await conn.execute("ALTER TABLE assemblies ADD COLUMN contract_id INTEGER REFERENCES contracts(id)")
            await conn.commit()
        # Индекс (всегда CREATE INDEX IF NOT EXISTS — идемпотентно)
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_assemblies_contract ON assemblies(contract_id)")
        await conn.commit()

    # ============ ЭТАП 15: миграция email в employees ============
    async with aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("PRAGMA table_info(employees)")
        rows = await cur.fetchall()
        cols = [r[1] for r in rows]
        if "email" not in cols:
            logger.info("Atomus DB: добавляю поле email в таблицу employees (Этап 15)")
            await conn.execute("ALTER TABLE employees ADD COLUMN email TEXT")
            await conn.commit()

    # ============ ЭТАП 16А: миграция valid_duration_* в sale_offers ============
    async with aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("PRAGMA table_info(sale_offers)")
        rows = await cur.fetchall()
        cols = [r[1] for r in rows]
        if "valid_duration_value" not in cols:
            logger.info("Atomus DB: добавляю поля valid_duration_* в sale_offers (Этап 16А)")
            await conn.execute("ALTER TABLE sale_offers ADD COLUMN valid_duration_value INTEGER")
            await conn.execute("ALTER TABLE sale_offers ADD COLUMN valid_duration_unit TEXT DEFAULT 'days'")
            await conn.commit()
        # Перечитываем колонки (после возможного добавления выше)
        cur = await conn.execute("PRAGMA table_info(sale_offers)")
        rows = await cur.fetchall()
        cols = [r[1] for r in rows]
        if "production_days" not in cols:
            logger.info("Atomus DB: добавляю поле production_days в sale_offers (Этап 16А-2)")
            await conn.execute("ALTER TABLE sale_offers ADD COLUMN production_days INTEGER")
            await conn.commit()

    # ============ ЭТАП 17: миграция категорий ============
    async with aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        # category_id в sale_products
        cur = await conn.execute("PRAGMA table_info(sale_products)")
        rows = await cur.fetchall()
        cols = [r[1] for r in rows]
        if "category_id" not in cols:
            logger.info("Atomus DB: добавляю поле category_id в sale_products (Этап 17)")
            await conn.execute("ALTER TABLE sale_products ADD COLUMN category_id INTEGER")
            await conn.commit()
        # Сидинг категорий по умолчанию (если таблица пуста)
        cur = await conn.execute("SELECT COUNT(*) AS cnt FROM sale_categories")
        row = await cur.fetchone()
        if row and row["cnt"] == 0:
            logger.info("Atomus DB: засеиваю категории по умолчанию (Этап 17)")
            default_cats = [
                ("Системы кондиционирования", 10),
                ("Вентиляция", 20),
                ("Холодильное оборудование", 30),
                ("Тепловое оборудование", 40),
                ("Услуги монтажа", 50),
                ("Расходные материалы", 60),
            ]
            for name, sort in default_cats:
                await conn.execute(
                    "INSERT OR IGNORE INTO sale_categories (name, sort_order) VALUES (?, ?)",
                    (name, sort),
                )
            await conn.commit()

    # ============ ЭТАП 16В-2: миграция contract_id в tasks ============
    # Связь задач с договорами. Опциональная (NULL допустим).
    # При архивации договора (is_active=0) связь сохраняется для истории.
    # При hard-delete договора задачи откреплятся через приложение
    # (см. функцию detach_tasks_from_contract).
    async with aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("PRAGMA table_info(tasks)")
        rows = await cur.fetchall()
        cols = [r[1] for r in rows]
        if "contract_id" not in cols:
            logger.info("Atomus DB: добавляю поле contract_id в таблицу tasks (Этап 16В-2)")
            await conn.execute("ALTER TABLE tasks ADD COLUMN contract_id INTEGER REFERENCES contracts(id)")
            await conn.commit()
        # Индекс (всегда CREATE INDEX IF NOT EXISTS — идемпотентно)
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_contract ON tasks(contract_id)")
        await conn.commit()

    # ============ ЭТАП 18: СКЛАД — миграция статусов assemblies + бэкфилл ============
    # Добавляем поле status в assemblies + создаём приходы на склад
    # для всех уже существующих сборок (идемпотентно — повторный запуск ничего не ломает).
    async with aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row

        # 1. Добавляем колонку status в assemblies, если её ещё нет
        cur = await conn.execute("PRAGMA table_info(assemblies)")
        rows = await cur.fetchall()
        cols = [r[1] for r in rows]
        if "status" not in cols:
            logger.info("Atomus DB: добавляю поле status в таблицу assemblies (Этап 18)")
            await conn.execute(
                "ALTER TABLE assemblies ADD COLUMN status TEXT NOT NULL DEFAULT 'in_progress'"
            )
            await conn.commit()

        # 2. Индекс на status (всегда — идемпотентно)
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_assemblies_status ON assemblies(status)"
        )
        await conn.commit()

        # 3. БЭКФИЛЛ: все существующие сборки считаем готовыми и сразу на складе.
        #    Сначала переводим всех is_active=1 со status='in_progress' в 'ready' —
        #    это разовая операция: если у сборки уже есть приход в журнал, она не трогается.
        cur = await conn.execute(
            """SELECT a.id, a.quantity
               FROM assemblies a
               WHERE a.is_active = 1
                 AND a.status = 'in_progress'
                 AND NOT EXISTS (
                     SELECT 1 FROM warehouse_movements m
                     WHERE m.assembly_id = a.id AND m.direction = 'in'
                 )"""
        )
        backfill_rows = await cur.fetchall()
        if backfill_rows:
            logger.info(
                "Atomus DB: бэкфилл %d существующих сборок → status='ready' + приход на склад (Этап 18)",
                len(backfill_rows),
            )
            for r in backfill_rows:
                aid = r["id"]
                qty = r["quantity"] or 1
                await conn.execute(
                    "UPDATE assemblies SET status = 'ready', updated_at = datetime('now') WHERE id = ?",
                    (aid,),
                )
                await conn.execute(
                    """INSERT INTO warehouse_movements
                       (assembly_id, direction, qty, reason, created_at)
                       VALUES (?, 'in', ?, 'Бэкфилл при миграции Этапа 18', datetime('now'))""",
                    (aid, qty),
                )
            await conn.commit()

        # ===== ЭТАП 21: QR-коды — public_token =====
        # 1. Добавляем колонки если их нет
        cur = await conn.execute("PRAGMA table_info(assemblies)")
        asm_cols = {r["name"] for r in await cur.fetchall()}
        if "public_token" not in asm_cols:
            logger.info("Atomus DB: добавляю public_token в assemblies (Этап 21)")
            await conn.execute("ALTER TABLE assemblies ADD COLUMN public_token TEXT")
            await conn.commit()

        cur = await conn.execute("PRAGMA table_info(contracts)")
        c_cols = {r["name"] for r in await cur.fetchall()}
        if "public_token" not in c_cols:
            logger.info("Atomus DB: добавляю public_token в contracts (Этап 21)")
            await conn.execute("ALTER TABLE contracts ADD COLUMN public_token TEXT")
            await conn.commit()

        # 2. Индексы (UNIQUE — критично: дубль токена недопустим)
        await conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_assemblies_public_token ON assemblies(public_token)"
        )
        await conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_public_token ON contracts(public_token)"
        )
        await conn.commit()

        # 3. Бэкфилл: для всех существующих записей без токена — генерируем новый
        import secrets
        cur = await conn.execute("SELECT id FROM assemblies WHERE public_token IS NULL OR public_token = ''")
        rows = await cur.fetchall()
        if rows:
            logger.info("Atomus DB: бэкфилл %d сборок public_token (Этап 21)", len(rows))
            for r in rows:
                token = secrets.token_urlsafe(8)  # ~11 символов, URL-safe
                await conn.execute(
                    "UPDATE assemblies SET public_token = ? WHERE id = ?",
                    (token, r["id"]),
                )
            await conn.commit()

        cur = await conn.execute("SELECT id FROM contracts WHERE public_token IS NULL OR public_token = ''")
        rows = await cur.fetchall()
        if rows:
            logger.info("Atomus DB: бэкфилл %d договоров public_token (Этап 21)", len(rows))
            for r in rows:
                token = secrets.token_urlsafe(8)
                await conn.execute(
                    "UPDATE contracts SET public_token = ? WHERE id = ?",
                    (token, r["id"]),
                )
            await conn.commit()

        # ===== ЭТАП 23: универсальные «работы» =====
        cur = await conn.execute("PRAGMA table_info(assemblies)")
        asm_cols = {r["name"] for r in await cur.fetchall()}
        new_cols = [
            ("work_type",   "TEXT NOT NULL DEFAULT 'assembly'"),
            ("description", "TEXT"),
            ("location",    "TEXT"),
            ("hours_spent", "REAL"),
        ]
        for col, ddl in new_cols:
            if col not in asm_cols:
                logger.info("Atomus DB: добавляю %s в assemblies (Этап 23)", col)
                await conn.execute(f"ALTER TABLE assemblies ADD COLUMN {col} {ddl}")
                await conn.commit()
        # Индекс по типу работ
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_assemblies_work_type ON assemblies(work_type)"
        )
        await conn.commit()
        # Бэкфилл — все существующие записи это сборки (assembly)
        await conn.execute(
            "UPDATE assemblies SET work_type = 'assembly' WHERE work_type IS NULL OR work_type = ''"
        )
        await conn.commit()

    # ============ ЭТАП 26: ОТГРУЗКИ ПО QR ============
    # boxes — коробки (контейнеры с QR-токеном, привязаны к договору)
    # shipments — журнал отгрузок (assembly_id ИЛИ box_id, по одному из них)
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            """CREATE TABLE IF NOT EXISTS boxes (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                qr_token     TEXT UNIQUE NOT NULL,
                contract_id  INTEGER REFERENCES contracts(id),
                name         TEXT,
                description  TEXT,
                created_at   TEXT DEFAULT (datetime('now')),
                created_by   INTEGER,
                is_active    INTEGER DEFAULT 1
            )"""
        )
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_boxes_contract ON boxes(contract_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_boxes_token    ON boxes(qr_token)")
        await conn.execute(
            """CREATE TABLE IF NOT EXISTS shipments (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                contract_id   INTEGER NOT NULL REFERENCES contracts(id),
                assembly_id   INTEGER REFERENCES assemblies(id),
                box_id        INTEGER REFERENCES boxes(id),
                shipped_by    INTEGER,
                shipped_at    TEXT DEFAULT (datetime('now')),
                CHECK (
                    (assembly_id IS NOT NULL AND box_id IS NULL) OR
                    (assembly_id IS NULL     AND box_id IS NOT NULL)
                )
            )"""
        )
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_shipments_contract ON shipments(contract_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_shipments_assembly ON shipments(assembly_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_shipments_box      ON shipments(box_id)")
        # Уникальность отгрузки — одну сборку/коробку нельзя отгрузить дважды
        await conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_shipments_assembly "
            "ON shipments(assembly_id) WHERE assembly_id IS NOT NULL"
        )
        await conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_shipments_box "
            "ON shipments(box_id) WHERE box_id IS NOT NULL"
        )
        await conn.commit()
        logger.info("Atomus DB: схема boxes/shipments готова (Этап 26)")

    # ============ ЭТАП 27: СПЕЦИФИКАЦИЯ ДОГОВОРА ============
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            """CREATE TABLE IF NOT EXISTS contract_items (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                contract_id  INTEGER NOT NULL REFERENCES contracts(id),
                position_no  INTEGER DEFAULT 0,
                name         TEXT NOT NULL,
                description  TEXT DEFAULT '',
                qty          REAL DEFAULT 1,
                unit         TEXT DEFAULT 'шт.',
                price        REAL DEFAULT 0,
                sum_amount   REAL DEFAULT 0,
                created_at   TEXT DEFAULT (datetime('now')),
                updated_at   TEXT DEFAULT (datetime('now')),
                is_active    INTEGER DEFAULT 1
            )"""
        )
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_contract_items_contract ON contract_items(contract_id)"
        )
        # Этап 27.1: связка с Номенклатурой (model_id) — миграция через ALTER TABLE
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("PRAGMA table_info(contract_items)")
        rows = await cur.fetchall()
        cols = [r[1] for r in rows]
        if "model_id" not in cols:
            logger.info("Atomus DB: добавляю поле model_id в contract_items (Этап 27.1)")
            await conn.execute(
                "ALTER TABLE contract_items ADD COLUMN model_id INTEGER REFERENCES models(id)"
            )
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_contract_items_model ON contract_items(model_id)"
        )
        await conn.commit()
        logger.info("Atomus DB: схема contract_items готова (Этап 27)")

    # ============ ЭТАП 28: ВХОД ПО ПАРОЛЮ ============
    # Добавляем сотрудникам поле password_hash для входа без Telegram.
    # auth_chat_id — виртуальный отрицательный chat_id (вне диапазона реальных TG)
    # для сотрудников без telegram_id; используется как идентификатор сессии.
    async with aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("PRAGMA table_info(employees)")
        rows = await cur.fetchall()
        cols = [r[1] for r in rows]
        if "password_hash" not in cols:
            logger.info("Atomus DB: добавляю password_hash в employees (Этап 28)")
            await conn.execute("ALTER TABLE employees ADD COLUMN password_hash TEXT")
            await conn.commit()
        if "password_set_at" not in cols:
            logger.info("Atomus DB: добавляю password_set_at в employees (Этап 28)")
            await conn.execute("ALTER TABLE employees ADD COLUMN password_set_at TEXT")
            await conn.commit()
        if "auth_chat_id" not in cols:
            logger.info("Atomus DB: добавляю auth_chat_id в employees (Этап 28)")
            await conn.execute("ALTER TABLE employees ADD COLUMN auth_chat_id INTEGER")
            await conn.commit()
        # Уникальный индекс на auth_chat_id (NULL'ы разрешены)
        await conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_auth_chat_id "
            "ON employees(auth_chat_id) WHERE auth_chat_id IS NOT NULL"
        )
        await conn.commit()
        logger.info("Atomus DB: схема password-входа готова (Этап 28)")

    # ============ v2.8.2: СПРАВОЧНИК ДОЛЖНОСТЕЙ ============
    # Простой справочник для выпадашки в форме сотрудника. Поле employees.position
    # остаётся текстовым (обратная совместимость) — справочник даёт подсказки.
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            """CREATE TABLE IF NOT EXISTS positions (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
                sort_order   INTEGER DEFAULT 100,
                is_active    INTEGER DEFAULT 1,
                created_at   TEXT DEFAULT (datetime('now')),
                updated_at   TEXT DEFAULT (datetime('now'))
            )"""
        )
        # Сидинг базовых должностей, если таблица пуста
        cur = await conn.execute("SELECT COUNT(*) AS cnt FROM positions")
        row = await cur.fetchone()
        if row and row[0] == 0:
            logger.info("Atomus DB: засеиваю базовые должности (v2.8.2)")
            defaults = [
                ("Директор", 10),
                ("Заместитель директора", 20),
                ("Менеджер по продажам", 30),
                ("Главный бухгалтер", 40),
                ("Бухгалтер", 50),
                ("Инженер-проектировщик", 60),
                ("Мастер производства", 70),
                ("Электромонтажник", 80),
                ("Сборщик-слесарь", 90),
                ("Кладовщик", 100),
                ("Снабженец", 110),
                ("Монтажник на выезде", 120),
            ]
            for name, sort in defaults:
                await conn.execute(
                    "INSERT OR IGNORE INTO positions (name, sort_order) VALUES (?, ?)",
                    (name, sort),
                )
        await conn.commit()
        logger.info("Atomus DB: схема positions готова (v2.8.2)")

    # ============ ЭТАП 29: УРОВНИ ДОСТУПА (PERMISSIONS) ============
    async with aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row

        # 1. Таблица уровней доступа
        await conn.execute(
            """CREATE TABLE IF NOT EXISTS access_levels (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
                permissions  TEXT NOT NULL DEFAULT '',
                sort_order   INTEGER DEFAULT 100,
                is_system    INTEGER DEFAULT 0,
                is_active    INTEGER DEFAULT 1,
                created_at   TEXT DEFAULT (datetime('now')),
                updated_at   TEXT DEFAULT (datetime('now'))
            )"""
        )

        # 2. Колонка access_level_id в employees
        cur = await conn.execute("PRAGMA table_info(employees)")
        rows = await cur.fetchall()
        cols = [r[1] for r in rows]
        if "access_level_id" not in cols:
            logger.info("Atomus DB: добавляю access_level_id в employees (Этап 29)")
            await conn.execute(
                "ALTER TABLE employees ADD COLUMN access_level_id INTEGER REFERENCES access_levels(id)"
            )
            await conn.commit()

        # 3. Сидинг 5 базовых уровней, если таблица пуста
        cur = await conn.execute("SELECT COUNT(*) AS cnt FROM access_levels")
        row = await cur.fetchone()
        if row and row[0] == 0:
            logger.info("Atomus DB: засеиваю базовые уровни доступа (Этап 29)")
            for level in BASE_ACCESS_LEVELS:
                await conn.execute(
                    """INSERT INTO access_levels (name, permissions, sort_order, is_system)
                       VALUES (?, ?, ?, ?)""",
                    (
                        level["name"],
                        ",".join(level["permissions"]),
                        level["sort_order"],
                        level["is_system"],
                    ),
                )
            await conn.commit()

        # 4. МИГРАЦИЯ ДАННЫХ: всем сотрудникам без access_level_id раздаём уровень
        # по их старым ролям. Приоритет: director > zam > manager > accountant > master/engineer.
        cur = await conn.execute(
            "SELECT id, roles FROM employees WHERE access_level_id IS NULL AND is_active = 1"
        )
        unmigrated = await cur.fetchall()
        if unmigrated:
            # Получим карту имя → id
            cur = await conn.execute("SELECT id, name FROM access_levels")
            level_rows = await cur.fetchall()
            name_to_id = {r["name"]: r["id"] for r in level_rows}

            ROLE_TO_LEVEL_NAME = [
                ("director",   "Директор"),
                ("zam",        "Заместитель директора"),
                ("manager",    "Менеджер по продажам"),
                ("accountant", "Бухгалтер"),
                ("master",     "Работник производства"),
                ("engineer",   "Работник производства"),
            ]
            migrated = 0
            for emp in unmigrated:
                emp_roles = {p.strip() for p in (emp["roles"] or "").split(",") if p.strip()}
                target_name = None
                for role_key, lvl_name in ROLE_TO_LEVEL_NAME:
                    if role_key in emp_roles:
                        target_name = lvl_name
                        break
                if target_name and target_name in name_to_id:
                    await conn.execute(
                        "UPDATE employees SET access_level_id = ?, updated_at = datetime('now') WHERE id = ?",
                        (name_to_id[target_name], emp["id"]),
                    )
                    migrated += 1
            if migrated:
                logger.info("Atomus DB: мигрировано %d сотрудников на уровни доступа (Этап 29)", migrated)
            await conn.commit()

        logger.info("Atomus DB: схема access_levels готова (Этап 29)")

    # ============ ЭТАП 30: СОДЕРЖИМОЕ КОРОБОК + ВНЕШНИЕ ОТГРУЗКИ ============
    # 30.1 Таблица box_items — что лежит в коробке
    # 30.2 Расширение shipments: contract_id NULLABLE + поля получателя для отгрузок вне договора
    async with aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row

        # 30.1 — box_items
        await conn.execute(
            """CREATE TABLE IF NOT EXISTS box_items (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                box_id        INTEGER NOT NULL REFERENCES boxes(id),
                source_type   TEXT NOT NULL,
                source_id     INTEGER,
                name          TEXT NOT NULL,
                qty           REAL DEFAULT 1,
                unit          TEXT DEFAULT 'шт.',
                comment       TEXT,
                created_at    TEXT DEFAULT (datetime('now')),
                created_by    INTEGER,
                is_active     INTEGER DEFAULT 1
            )"""
        )
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_box_items_box ON box_items(box_id)"
        )
        await conn.commit()
        logger.info("Atomus DB: схема box_items готова (Этап 30.1)")

        # 30.2 — миграция shipments под внешние отгрузки
        # SQLite не умеет ALTER на изменение NOT NULL → пересоздаём таблицу
        cur = await conn.execute("PRAGMA table_info(shipments)")
        ship_cols = [r[1] for r in await cur.fetchall()]
        needs_rebuild = ("recipient_type" not in ship_cols)
        if needs_rebuild:
            logger.info("Atomus DB: пересобираю shipments под внешние отгрузки (Этап 30.2)")
            # 1) переименовать старую
            await conn.execute("ALTER TABLE shipments RENAME TO _shipments_old")
            # 2) создать новую (contract_id NULLABLE)
            await conn.execute(
                """CREATE TABLE shipments (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    contract_id     INTEGER REFERENCES contracts(id),
                    assembly_id     INTEGER REFERENCES assemblies(id),
                    box_id          INTEGER REFERENCES boxes(id),
                    shipped_by      INTEGER,
                    shipped_at      TEXT DEFAULT (datetime('now')),
                    recipient_type  TEXT,
                    recipient_inn   TEXT,
                    recipient_name  TEXT,
                    recipient_comment TEXT,
                    CHECK (
                        (assembly_id IS NOT NULL AND box_id IS NULL) OR
                        (assembly_id IS NULL     AND box_id IS NOT NULL)
                    )
                )"""
            )
            # 3) перенести данные
            await conn.execute(
                """INSERT INTO shipments
                    (id, contract_id, assembly_id, box_id, shipped_by, shipped_at, recipient_type)
                   SELECT id, contract_id, assembly_id, box_id, shipped_by, shipped_at, 'contract'
                   FROM _shipments_old"""
            )
            # 4) дропнуть старую
            await conn.execute("DROP TABLE _shipments_old")
            # 5) восстановить индексы
            await conn.execute("CREATE INDEX IF NOT EXISTS idx_shipments_contract ON shipments(contract_id)")
            await conn.execute("CREATE INDEX IF NOT EXISTS idx_shipments_assembly ON shipments(assembly_id)")
            await conn.execute("CREATE INDEX IF NOT EXISTS idx_shipments_box      ON shipments(box_id)")
            await conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_shipments_assembly "
                "ON shipments(assembly_id) WHERE assembly_id IS NOT NULL"
            )
            await conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_shipments_box "
                "ON shipments(box_id) WHERE box_id IS NOT NULL"
            )
            await conn.commit()
            logger.info("Atomus DB: shipments пересобрана (Этап 30.2)")

    logger.info("Atomus DB готова: %s", DB_PATH)


# ============ ВНУТРЕННИЕ ХЕЛПЕРЫ ДЛЯ ВЫПОЛНЕНИЯ ЗАПРОСОВ ============


async def _fetch_all(query: str, params: tuple = ()) -> list[dict]:
    """SELECT → список dict."""
    async with aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        async with conn.execute(query, params) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


async def _fetch_one(query: str, params: tuple = ()) -> dict | None:
    """SELECT → первый dict или None."""
    async with aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        async with conn.execute(query, params) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def _fetch_scalar(query: str, params: tuple = ()) -> Any:
    """SELECT → первое поле первой строки (для COUNT и т.п.)."""
    async with aiosqlite.connect(DB_PATH) as conn:
        async with conn.execute(query, params) as cur:
            row = await cur.fetchone()
            return row[0] if row else None


async def _execute(query: str, params: tuple = ()) -> int:
    """INSERT/UPDATE/DELETE → lastrowid."""
    async with aiosqlite.connect(DB_PATH) as conn:
        cur = await conn.execute(query, params)
        await conn.commit()
        return cur.lastrowid


# ============ НАПРАВЛЕНИЯ ============


async def get_directions(only_active: bool = True) -> list[dict]:
    query = "SELECT * FROM directions"
    if only_active:
        query += " WHERE is_active = 1"
    query += " ORDER BY sort_order, id"
    return await _fetch_all(query)


async def get_direction_by_code(code: str) -> dict | None:
    return await _fetch_one("SELECT * FROM directions WHERE code = ?", (code,))


async def get_direction_by_id(direction_id: int) -> dict | None:
    return await _fetch_one("SELECT * FROM directions WHERE id = ?", (direction_id,))


# ============ КАТЕГОРИИ ============


async def get_categories(direction_id: int) -> list[dict]:
    return await _fetch_all(
        "SELECT * FROM categories WHERE direction_id = ? AND is_active = 1 "
        "ORDER BY sort_order, id",
        (direction_id,),
    )


async def get_category_by_id(category_id: int) -> dict | None:
    return await _fetch_one("SELECT * FROM categories WHERE id = ?", (category_id,))


# ============ ПОДГРУППЫ ============


async def get_subgroups(direction_id: int) -> list[dict]:
    return await _fetch_all(
        "SELECT * FROM subgroups WHERE direction_id = ? AND is_active = 1 "
        "ORDER BY sort_order, code",
        (direction_id,),
    )


async def get_subgroup_by_id(subgroup_id: int) -> dict | None:
    return await _fetch_one("SELECT * FROM subgroups WHERE id = ?", (subgroup_id,))


# ============ МОДЕЛИ ============


async def get_models_by_direction(direction_id: int) -> list[dict]:
    """Модели, привязанные напрямую к направлению (без category/subgroup)."""
    return await _fetch_all(
        "SELECT * FROM models WHERE direction_id = ? "
        "AND category_id IS NULL AND subgroup_id IS NULL "
        "AND is_active = 1 ORDER BY sort_order, id",
        (direction_id,),
    )


async def get_models_by_category(category_id: int) -> list[dict]:
    return await _fetch_all(
        "SELECT * FROM models WHERE category_id = ? AND is_active = 1 "
        "ORDER BY sort_order, id",
        (category_id,),
    )


async def get_models_by_subgroup(subgroup_id: int) -> list[dict]:
    return await _fetch_all(
        "SELECT * FROM models WHERE subgroup_id = ? AND is_active = 1 "
        "ORDER BY sort_order, id",
        (subgroup_id,),
    )


async def get_model_by_id(model_id: int) -> dict | None:
    return await _fetch_one("SELECT * FROM models WHERE id = ?", (model_id,))


async def search_models(query: str, limit: int = 20) -> list[dict]:
    """Поиск по моделям. Ищет в одном поле search_text, которое содержит
    name + article + description + extra в нижнем регистре.

    SQLite LOWER() некорректно работает с кириллицей, поэтому мы используем
    предвычисленное поле search_text (заполняется при insert/update).
    """
    pattern = f"%{query.lower()}%"
    sql = """SELECT m.*, d.name as direction_name, d.code as direction_code,
                    c.name as category_name, s.name as subgroup_name
             FROM models m
             LEFT JOIN directions d ON m.direction_id = d.id
             LEFT JOIN categories c ON m.category_id = c.id
             LEFT JOIN subgroups s  ON m.subgroup_id  = s.id
             WHERE m.is_active = 1 AND m.search_text LIKE ?
             ORDER BY m.direction_id, m.sort_order
             LIMIT ?"""
    return await _fetch_all(sql, (pattern, limit))


# ============ АДМИНКА МОДЕЛЕЙ ============


async def get_all_models_by_direction(direction_id: int) -> list[dict]:
    """Все модели направления (включая деактивированные) — для админки.
    Активные сверху, деактивированные внизу."""
    return await _fetch_all(
        "SELECT * FROM models WHERE direction_id = ? "
        "ORDER BY is_active DESC, sort_order, id",
        (direction_id,),
    )


async def get_model_by_article(article: str) -> dict | None:
    """Поиск по точному артикулу — нужен для проверки уникальности при создании."""
    return await _fetch_one(
        "SELECT * FROM models WHERE article = ?",
        (article,),
    )


def _build_search_text(name: str, article: str, description: str | None = None,
                        extra: str | None = None) -> str:
    """Собирает search_text из полей модели (всё в нижнем регистре)."""
    parts = []
    for v in (name, article, description, extra):
        if v:
            parts.append(str(v).lower())
    return " ".join(parts)


async def create_model(
    *,
    direction_id: int,
    category_id: int | None = None,
    subgroup_id: int | None = None,
    article: str,
    name: str,
    extra: str | None = None,
    description: str | None = None,
    exec_mode: str = "none",
    exec_fixed: str | None = None,
    exec_label_st: str = "Стандарт",
    exec_label_ne: str = "Нерж. AISI",
    needs_ip: bool = False,
    work_type: str = "full_build",
) -> int:
    """Создаёт новую модель. Артикул должен быть уникален.

    exec_mode: 'none' | 'choice' | 'fixed'
    work_type: 'full_build' | 'modify_purchased'

    Поднимает исключение если артикул уже есть.
    """
    search_text = _build_search_text(name, article, description, extra)
    return await _execute(
        """INSERT INTO models
           (direction_id, category_id, subgroup_id, article, name, extra,
            description, exec_mode, exec_fixed, exec_label_st, exec_label_ne,
            needs_ip, work_type, search_text)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (direction_id, category_id, subgroup_id, article, name, extra,
         description, exec_mode, exec_fixed, exec_label_st, exec_label_ne,
         1 if needs_ip else 0, work_type, search_text),
    )


async def update_model(
    model_id: int,
    *,
    name: str | None = None,
    extra: str | None = None,
    description: str | None = None,
    exec_mode: str | None = None,
    exec_fixed: str | None = None,
    needs_ip: bool | None = None,
    work_type: str | None = None,
) -> bool:
    """Обновляет поля модели (только переданные не-None).

    Артикул, direction_id, category_id, subgroup_id меняться НЕ должны —
    они являются "якорями" истории сборок. Если такая модель неправильно
    привязана — лучше деактивировать и создать новую.

    После обновления пересчитывается search_text.
    """
    current = await get_model_by_id(model_id)
    if not current:
        return False

    fields = []
    values: list[Any] = []
    for col, val in [
        ("name", name),
        ("extra", extra),
        ("description", description),
        ("exec_mode", exec_mode),
        ("exec_fixed", exec_fixed),
        ("work_type", work_type),
    ]:
        if val is not None:
            fields.append(f"{col} = ?")
            values.append(val)

    if needs_ip is not None:
        fields.append("needs_ip = ?")
        values.append(1 if needs_ip else 0)

    # Пересчитываем search_text если меняются влияющие поля
    if any(v is not None for v in (name, extra, description)):
        new_name = name if name is not None else current["name"]
        new_extra = extra if extra is not None else current.get("extra")
        new_description = description if description is not None else current.get("description")
        new_search = _build_search_text(
            new_name, current["article"], new_description, new_extra,
        )
        fields.append("search_text = ?")
        values.append(new_search)

    if not fields:
        return True

    values.append(model_id)

    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            f"UPDATE models SET {', '.join(fields)} WHERE id = ?",
            tuple(values),
        )
        await conn.commit()
    return True


async def set_model_active(model_id: int, is_active: bool) -> bool:
    """Активирует/деактивирует модель (soft-delete).
    Старые сборки сохраняются и продолжают видеться в истории/сводках."""
    await _execute(
        "UPDATE models SET is_active = ? WHERE id = ?",
        (1 if is_active else 0, model_id),
    )
    return True


async def count_assemblies_for_model(model_id: int) -> int:
    """Сколько сборок ссылается на модель — для безопасности при правках/деактивации."""
    return await _fetch_scalar(
        "SELECT COUNT(*) FROM assemblies WHERE model_id = ? AND is_active = 1",
        (model_id,),
    ) or 0


# ============ СОТРУДНИКИ ============


async def get_active_employees() -> list[dict]:
    return await _fetch_all(
        "SELECT * FROM employees WHERE is_active = 1 ORDER BY full_name"
    )


async def get_all_employees(include_inactive: bool = True) -> list[dict]:
    """Все сотрудники (для админки) — включая деактивированных."""
    if include_inactive:
        return await _fetch_all("SELECT * FROM employees ORDER BY is_active DESC, full_name")
    return await get_active_employees()


async def get_employee_by_id(emp_id: int) -> dict | None:
    return await _fetch_one("SELECT * FROM employees WHERE id = ?", (emp_id,))


async def get_employee_by_telegram_id(telegram_id: int) -> dict | None:
    return await _fetch_one(
        "SELECT * FROM employees WHERE telegram_id = ? AND is_active = 1",
        (telegram_id,),
    )


def _short_from_full(full_name: str) -> str:
    """'Иванов Иван Иванович' → 'Иванов И.И.'"""
    parts = full_name.strip().split()
    if len(parts) >= 2:
        return parts[0] + " " + ".".join(p[0] for p in parts[1:]) + "."
    return full_name


async def create_employee(full_name: str, position: str = "",
                            phone: str = "", email: str = "",
                            tab_number: str = "",
                            short_name: str = "",
                            telegram_id: int | None = None,
                            roles: str = "") -> int:
    """Создаёт сотрудника. Если short_name не задан — генерируется автоматически."""
    if not short_name:
        short_name = _short_from_full(full_name)
    return await _execute(
        """INSERT INTO employees
           (full_name, short_name, position, phone, email, tab_number, telegram_id, roles)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (full_name, short_name, position, phone, email, tab_number, telegram_id, roles),
    )


async def update_employee(
    emp_id: int,
    full_name: str | None = None,
    short_name: str | None = None,
    position: str | None = None,
    phone: str | None = None,
    email: str | None = None,
    tab_number: str | None = None,
    telegram_id: int | None = None,
    roles: str | None = None,
) -> bool:
    """Обновляет поля сотрудника (только переданные не-None).

    Если меняется full_name и short_name не передан — short_name пересчитывается.
    """
    current = await get_employee_by_id(emp_id)
    if not current:
        return False

    # Если меняется full_name а short_name не передали — пересоберём
    if full_name is not None and short_name is None:
        short_name = _short_from_full(full_name)

    fields = []
    values: list[Any] = []
    for col, val in [
        ("full_name", full_name),
        ("short_name", short_name),
        ("position", position),
        ("phone", phone),
        ("email", email),
        ("tab_number", tab_number),
        ("telegram_id", telegram_id),
        ("roles", roles),
    ]:
        if val is not None:
            fields.append(f"{col} = ?")
            values.append(val)
    if not fields:
        return True  # нечего обновлять

    fields.append("updated_at = datetime('now')")
    values.append(emp_id)

    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            f"UPDATE employees SET {', '.join(fields)} WHERE id = ?",
            tuple(values),
        )
        await conn.commit()
    return True


async def set_employee_active(emp_id: int, is_active: bool) -> bool:
    """Активирует/деактивирует сотрудника (soft-delete)."""
    await _execute(
        "UPDATE employees SET is_active = ?, updated_at = datetime('now') WHERE id = ?",
        (1 if is_active else 0, emp_id),
    )
    return True


async def count_directors() -> int:
    """Сколько активных директоров в системе (для защиты от удаления последнего)."""
    rows = await _fetch_all(
        "SELECT roles FROM employees WHERE is_active = 1 AND roles LIKE '%director%'"
    )
    # Защита от ложных срабатываний (вдруг в роли есть подстрока "director" не как роль)
    count = 0
    for r in rows:
        parts = [p.strip() for p in (r["roles"] or "").split(",") if p.strip()]
        if "director" in parts:
            count += 1
    return count


async def load_roles_to_cache() -> dict[int, set[str]]:
    """Загружает все привязки telegram_id → roles из БД в виде словаря.

    Возвращает: {telegram_id: {'master', 'director', ...}, ...}
    Вызывается при старте бота и после изменений в админке.

    Этап 28: для сотрудников БЕЗ telegram_id, но с паролем — используем
    виртуальный auth_chat_id (отрицательное число), который тоже попадёт в кэш.
    Так get_user_roles(chat_id) работает для обоих типов входа без правок.

    Этап 29: legacy-роли derive-ятся из permissions уровня доступа.
    Старый код (`'master' in roles`, @require_director) продолжает работать
    через обратную совместимость.
    """
    # Карта level_id → permissions
    level_perms_rows = await _fetch_all(
        "SELECT id, permissions FROM access_levels WHERE is_active = 1"
    )
    level_perms_map: dict[int, set[str]] = {}
    for r in level_perms_rows:
        keys = {p.strip() for p in (r.get("permissions") or "").split(",") if p.strip()}
        level_perms_map[int(r["id"])] = keys

    def roles_for_emp(emp_row: dict) -> set[str]:
        """Вычисляет legacy-роли для сотрудника. Если у него есть access_level_id —
        derive из его permissions; иначе берём роли из поля roles напрямую."""
        level_id = emp_row.get("access_level_id")
        if level_id and int(level_id) in level_perms_map:
            return derive_legacy_roles(level_perms_map[int(level_id)])
        # Fallback на старое поле roles (если миграция ещё не прошла или сотрудник без уровня)
        roles_str = emp_row.get("roles") or ""
        return {p.strip() for p in roles_str.split(",") if p.strip()}

    cache: dict[int, set[str]] = {}

    # Сотрудники с реальным telegram_id (вход через бота)
    rows = await _fetch_all(
        "SELECT telegram_id, roles, access_level_id FROM employees "
        "WHERE is_active = 1 AND telegram_id IS NOT NULL AND telegram_id != 0"
    )
    for r in rows:
        tid = r["telegram_id"]
        if not tid:
            continue
        roles = roles_for_emp(r)
        if roles:
            cache[int(tid)] = roles

    # Этап 28: сотрудники с auth_chat_id (вход по паролю, без Telegram)
    rows_auth = await _fetch_all(
        "SELECT auth_chat_id, roles, access_level_id FROM employees "
        "WHERE is_active = 1 AND auth_chat_id IS NOT NULL"
    )
    for r in rows_auth:
        aid = r["auth_chat_id"]
        if not aid:
            continue
        roles = roles_for_emp(r)
        if roles:
            cache[int(aid)] = roles
    return cache


# ============ ЭТАП 28: ВХОД ПО ПАРОЛЮ ============

# Виртуальные chat_id для сотрудников без Telegram лежат глубоко в отрицательной
# области (Telegram использует отрицательные только для групповых чатов, начиная
# с -100). Берём диапазон ниже -1_000_000_000 — он гарантированно не пересечётся.
_AUTH_CHAT_ID_OFFSET = -1_000_000_000

# Параметры PBKDF2. 200k итераций — разумный baseline для 2026 года
# (Django по умолчанию использует 600k+, но для нашего масштаба ~50ms/проверка хватает).
_PBKDF2_ITERATIONS = 200_000
_PBKDF2_ALG = "pbkdf2_sha256"


def _hash_password(password: str) -> str:
    """PBKDF2-SHA256 с per-user солью. Формат: 'pbkdf2_sha256$iters$salt_hex$dk_hex'."""
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"{_PBKDF2_ALG}${_PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    """Сравнивает пароль с сохранённым хешем. Constant-time."""
    if not password or not stored:
        return False
    try:
        alg, iters_str, salt_hex, dk_hex = stored.split("$")
        if alg != _PBKDF2_ALG:
            return False
        iterations = int(iters_str)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(dk_hex)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(dk, expected)
    except (ValueError, TypeError):
        return False


def _virtual_auth_chat_id(emp_id: int) -> int:
    """Генерирует виртуальный отрицательный chat_id для сотрудника без Telegram."""
    return _AUTH_CHAT_ID_OFFSET - emp_id


async def set_employee_password(emp_id: int, password: str) -> bool:
    """Устанавливает пароль сотруднику. Хеширует, сохраняет, при необходимости
    генерирует виртуальный auth_chat_id (чтобы попасть в кэш ролей).

    Если хочешь снять пароль — используй clear_employee_password.

    Возвращает True при успехе, False если сотрудник не найден.
    """
    emp = await get_employee_by_id(emp_id)
    if not emp:
        return False
    pwd_hash = _hash_password(password)
    # Если у сотрудника нет telegram_id и нет auth_chat_id — выдаём виртуальный
    auth_chat_id = emp.get("auth_chat_id")
    if not emp.get("telegram_id") and not auth_chat_id:
        auth_chat_id = _virtual_auth_chat_id(emp_id)
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            """UPDATE employees SET
                 password_hash = ?,
                 password_set_at = datetime('now'),
                 auth_chat_id = COALESCE(auth_chat_id, ?),
                 updated_at = datetime('now')
               WHERE id = ?""",
            (pwd_hash, auth_chat_id, emp_id),
        )
        await conn.commit()
    return True


async def clear_employee_password(emp_id: int) -> bool:
    """Удаляет пароль сотрудника. auth_chat_id оставляем — он может ещё пригодиться,
    но без password_hash войти всё равно не получится."""
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            """UPDATE employees SET
                 password_hash = NULL,
                 password_set_at = NULL,
                 updated_at = datetime('now')
               WHERE id = ?""",
            (emp_id,),
        )
        await conn.commit()
    return True


async def verify_password_and_get_employee(password: str) -> dict | None:
    """Ищет активного сотрудника, чей пароль совпадает с введённым.

    Перебор линейный (с PBKDF2 на каждой строке), но при N<100 это ~5 секунд max
    и одновременно работает как естественный rate-limit. Возвращает dict сотрудника
    или None.

    ВАЖНО: пустые пароли отвергаются здесь, не в API — чтобы случайно не
    подобрать пустым строкой к битому хешу.
    """
    if not password or len(password) < 6:
        return None
    rows = await _fetch_all(
        """SELECT id, full_name, short_name, position, phone, email,
                  telegram_id, auth_chat_id, roles, password_hash
           FROM employees
           WHERE is_active = 1
             AND password_hash IS NOT NULL
             AND password_hash != ''"""
    )
    for r in rows:
        if _verify_password(password, r["password_hash"]):
            # Не возвращаем сам хеш наружу
            r.pop("password_hash", None)
            return r
    return None


async def employee_password_exists(password: str) -> bool:
    """Проверяет, не используется ли уже такой пароль другим активным сотрудником.
    Нужно для уникальности при создании/смене пароля (т.к. вход по одному полю)."""
    return (await verify_password_and_get_employee(password)) is not None


async def get_employee_by_auth_chat_id(auth_chat_id: int) -> dict | None:
    """Получить сотрудника по виртуальному auth_chat_id (для middleware при
    обработке запросов от password-логина)."""
    return await _fetch_one(
        "SELECT * FROM employees WHERE auth_chat_id = ?", (auth_chat_id,)
    )


# ============ ЖУРНАЛ СБОРОК ============


async def create_assembly(
    model_id: int | None,
    quantity: int,
    assembly_date: str,
    worker_ids: list[int],
    execution: str | None = None,
    ip_class: str | None = None,
    comment: str = "",
    contract_id: int | None = None,  # ЭТАП 15: опциональная привязка к договору
    created_by_chat_id: int | None = None,
    work_type: str = "assembly",     # ЭТАП 23: тип работы
    description: str | None = None,  # ЭТАП 23: описание (обязательно для не-сборок)
    location: str | None = None,     # ЭТАП 23: локация
    hours_spent: float | None = None, # ЭТАП 23: часы
) -> int:
    """Создаёт запись о работе. Возвращает ID.

    work_type определяет поведение:
    - 'assembly' (по умолчанию) — классическая сборка, модель обязательна,
      автоматически создаётся приход на склад, status='ready'.
    - другие типы (repair, commissioning, installation, ...) — услуга,
      на склад не идёт, model_id опциональна, status сразу 'ready'.

    ЭТАП 21: При создании сразу генерируется public_token для QR-кода.
    """
    import secrets
    public_token = secrets.token_urlsafe(8)
    if work_type not in WORK_TYPE_LABELS:
        work_type = "assembly"
    is_assembly = (work_type == "assembly")
    async with aiosqlite.connect(DB_PATH) as conn:
        cur = await conn.execute(
            """INSERT INTO assemblies
               (model_id, execution, ip_class, quantity, assembly_date, comment,
                contract_id, status, public_token, work_type, description, location, hours_spent,
                created_by_chat_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?)""",
            (model_id, execution, ip_class, quantity, assembly_date, comment,
             contract_id, public_token, work_type,
             (description or "").strip() or None,
             (location or "").strip() or None,
             hours_spent,
             created_by_chat_id),
        )
        assembly_id = cur.lastrowid
        for wid in worker_ids:
            await conn.execute(
                "INSERT INTO assembly_workers (assembly_id, employee_id) VALUES (?, ?)",
                (assembly_id, wid),
            )
        # ЭТАП 18+23: автоматический приход на склад только для assembly
        if is_assembly:
            await conn.execute(
                """INSERT INTO warehouse_movements
                   (assembly_id, direction, qty, reason, created_by_chat_id)
                   VALUES (?, 'in', ?, 'Сборка завершена', ?)""",
                (assembly_id, quantity, created_by_chat_id),
            )
        await conn.commit()
        return assembly_id


async def get_assemblies_by_period(
    date_from: str,
    date_to: str,
    direction_id: int | None = None,
    employee_id: int | None = None,
) -> list[dict]:
    """Сборки за период с фильтрами. Развёрнутые — по сборщикам."""
    sql = """
        SELECT
            a.id            AS assembly_id,
            a.assembly_date AS date,
            a.quantity      AS qty,
            a.execution     AS execution,
            a.ip_class      AS ip_class,
            a.comment       AS comment,
            a.contract_id   AS contract_id,
            ctr.number      AS contract_number,
            co.name         AS contract_contractor_name,
            m.id            AS model_id,
            m.article       AS article,
            m.name          AS model_name,
            m.extra         AS model_extra,
            m.exec_label_st AS exec_label_st,
            m.exec_label_ne AS exec_label_ne,
            d.name          AS direction_name,
            d.code          AS direction_code,
            c.name          AS category_name,
            s.name          AS subgroup_name,
            e.id            AS employee_id,
            e.full_name     AS employee_full_name,
            e.short_name    AS employee_short_name
        FROM assemblies a
        JOIN models m ON a.model_id = m.id
        JOIN directions d ON m.direction_id = d.id
        LEFT JOIN categories c ON m.category_id = c.id
        LEFT JOIN subgroups s ON m.subgroup_id = s.id
        LEFT JOIN contracts ctr ON ctr.id = a.contract_id
        LEFT JOIN contractors co ON co.id = ctr.contractor_id
        JOIN assembly_workers aw ON aw.assembly_id = a.id
        JOIN employees e ON aw.employee_id = e.id
        WHERE a.is_active = 1
          AND a.assembly_date BETWEEN ? AND ?
    """
    params: list[Any] = [date_from, date_to]
    if direction_id is not None:
        sql += " AND m.direction_id = ?"
        params.append(direction_id)
    if employee_id is not None:
        sql += " AND e.id = ?"
        params.append(employee_id)
    sql += " ORDER BY a.assembly_date DESC, a.id DESC, e.full_name"
    return await _fetch_all(sql, tuple(params))


# ============ ИСТОРИЯ ЗАПИСЕЙ ============


async def get_assembly_with_workers(assembly_id: int) -> dict | None:
    """Получить одну запись со всеми связанными данными: модель, направление, сборщики."""
    sql = """
        SELECT a.*, m.article, m.name as model_name, m.extra as model_extra,
               m.exec_label_st, m.exec_label_ne, m.exec_mode, m.exec_fixed,
               m.needs_ip, m.description as model_description,
               d.name as direction_name, d.code as direction_code,
               c.name as category_name, s.name as subgroup_name,
               ctr.number as contract_number,
               co.name as contract_contractor_name
        FROM assemblies a
        JOIN models m ON a.model_id = m.id
        JOIN directions d ON m.direction_id = d.id
        LEFT JOIN categories c ON m.category_id = c.id
        LEFT JOIN subgroups s ON m.subgroup_id = s.id
        LEFT JOIN contracts ctr ON ctr.id = a.contract_id
        LEFT JOIN contractors co ON co.id = ctr.contractor_id
        WHERE a.id = ? AND a.is_active = 1
    """
    a = await _fetch_one(sql, (assembly_id,))
    if not a:
        return None
    # Сборщики этой записи
    workers = await _fetch_all(
        """SELECT e.id, e.full_name, e.short_name
           FROM assembly_workers aw
           JOIN employees e ON aw.employee_id = e.id
           WHERE aw.assembly_id = ?
           ORDER BY e.full_name""",
        (assembly_id,),
    )
    a["workers"] = workers
    return a


async def get_user_assemblies(
    chat_id: int,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 50,
) -> list[dict]:
    """Записи, которые внёс этот пользователь. Со списком сборщиков (через GROUP_CONCAT)."""
    sql = """
        SELECT a.id, a.assembly_date, a.quantity, a.execution, a.ip_class,
               a.comment, a.created_at, a.updated_at,
               m.article, m.name as model_name, m.extra as model_extra,
               m.exec_label_st, m.exec_label_ne, m.exec_mode, m.exec_fixed,
               d.name as direction_name,
               (SELECT GROUP_CONCAT(COALESCE(e.short_name, e.full_name), ', ')
                FROM assembly_workers aw
                JOIN employees e ON aw.employee_id = e.id
                WHERE aw.assembly_id = a.id) as workers_str
        FROM assemblies a
        JOIN models m ON a.model_id = m.id
        JOIN directions d ON m.direction_id = d.id
        WHERE a.is_active = 1 AND a.created_by_chat_id = ?
    """
    params: list[Any] = [chat_id]
    if date_from:
        sql += " AND a.assembly_date >= ?"
        params.append(date_from)
    if date_to:
        sql += " AND a.assembly_date <= ?"
        params.append(date_to)
    sql += " ORDER BY a.assembly_date DESC, a.id DESC LIMIT ?"
    params.append(limit)
    return await _fetch_all(sql, tuple(params))


async def count_user_assemblies(
    chat_id: int,
    date_from: str | None = None,
    date_to: str | None = None,
) -> int:
    """Сумма quantity по записям пользователя за период."""
    sql = "SELECT COALESCE(SUM(quantity), 0) FROM assemblies WHERE is_active = 1 AND created_by_chat_id = ?"
    params: list[Any] = [chat_id]
    if date_from:
        sql += " AND assembly_date >= ?"
        params.append(date_from)
    if date_to:
        sql += " AND assembly_date <= ?"
        params.append(date_to)
    return await _fetch_scalar(sql, tuple(params)) or 0


async def update_assembly(
    assembly_id: int,
    quantity: int,
    worker_ids: list[int],
    execution: str | None = None,
    ip_class: str | None = None,
    comment: str = "",
    updated_by_chat_id: int | None = None,
) -> bool:
    """Обновляет существующую запись (модель и дата не меняются — только параметры)."""
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            """UPDATE assemblies
               SET execution = ?, ip_class = ?, quantity = ?, comment = ?,
                   updated_at = datetime('now'), updated_by_chat_id = ?
               WHERE id = ? AND is_active = 1""",
            (execution, ip_class, quantity, comment, updated_by_chat_id, assembly_id),
        )
        # Перезаписываем сборщиков (удаляем старые, добавляем новые)
        await conn.execute(
            "DELETE FROM assembly_workers WHERE assembly_id = ?", (assembly_id,)
        )
        for wid in worker_ids:
            await conn.execute(
                "INSERT INTO assembly_workers (assembly_id, employee_id) VALUES (?, ?)",
                (assembly_id, wid),
            )
        await conn.commit()
        return True


async def is_assembly_editable_by_user(assembly_id: int, today_iso: str) -> bool:
    """Можно ли мастеру самому редактировать запись.
    Можно, если запись создана СЕГОДНЯ (по дате assembly_date) — то есть до конца дня правки.
    """
    sql = "SELECT assembly_date FROM assemblies WHERE id = ? AND is_active = 1"
    res = await _fetch_one(sql, (assembly_id,))
    if not res:
        return False
    return res["assembly_date"] == today_iso


# ============ AUDIT LOG ============


async def log_action(
    chat_id: int | None,
    action: str,
    entity: str = "",
    entity_id: int | None = None,
    payload: str = "",
):
    await _execute(
        """INSERT INTO audit_log (chat_id, action, entity, entity_id, payload)
           VALUES (?, ?, ?, ?, ?)""",
        (chat_id, action, entity, entity_id, payload),
    )


async def get_audit_log(
    date_from: str | None = None,
    date_to: str | None = None,
    chat_id_filter: int | None = None,
    action_filter: str | None = None,
    entity_filter: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Получает записи журнала с фильтрами.

    Возвращает с присоединённым именем пользователя (если есть в employees).
    Сортировка по времени убывания (свежие сверху).
    """
    sql = """
        SELECT
            a.id           AS id,
            a.chat_id      AS chat_id,
            a.action       AS action,
            a.entity       AS entity,
            a.entity_id    AS entity_id,
            a.payload      AS payload,
            a.created_at   AS created_at,
            e.full_name    AS user_full_name,
            e.short_name   AS user_short_name
        FROM audit_log a
        LEFT JOIN employees e ON e.telegram_id = a.chat_id
        WHERE 1=1
    """
    params: list[Any] = []
    if date_from:
        sql += " AND a.created_at >= ?"
        params.append(date_from + " 00:00:00")
    if date_to:
        sql += " AND a.created_at <= ?"
        params.append(date_to + " 23:59:59")
    if chat_id_filter is not None:
        sql += " AND a.chat_id = ?"
        params.append(chat_id_filter)
    if action_filter:
        sql += " AND a.action = ?"
        params.append(action_filter)
    if entity_filter:
        sql += " AND a.entity = ?"
        params.append(entity_filter)
    sql += " ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    return await _fetch_all(sql, tuple(params))


async def count_audit_log(
    date_from: str | None = None,
    date_to: str | None = None,
    chat_id_filter: int | None = None,
    action_filter: str | None = None,
    entity_filter: str | None = None,
) -> int:
    """Подсчёт количества записей с теми же фильтрами — для пагинации."""
    sql = "SELECT COUNT(*) FROM audit_log a WHERE 1=1"
    params: list[Any] = []
    if date_from:
        sql += " AND a.created_at >= ?"
        params.append(date_from + " 00:00:00")
    if date_to:
        sql += " AND a.created_at <= ?"
        params.append(date_to + " 23:59:59")
    if chat_id_filter is not None:
        sql += " AND a.chat_id = ?"
        params.append(chat_id_filter)
    if action_filter:
        sql += " AND a.action = ?"
        params.append(action_filter)
    if entity_filter:
        sql += " AND a.entity = ?"
        params.append(entity_filter)
    return await _fetch_scalar(sql, tuple(params)) or 0


async def get_audit_entry(entry_id: int) -> dict | None:
    """Одна запись журнала со всей информацией."""
    sql = """
        SELECT a.*, e.full_name AS user_full_name, e.short_name AS user_short_name
        FROM audit_log a
        LEFT JOIN employees e ON e.telegram_id = a.chat_id
        WHERE a.id = ?
    """
    return await _fetch_one(sql, (entry_id,))


async def get_audit_users_in_period(date_from: str, date_to: str) -> list[dict]:
    """Список пользователей, делавших действия в этот период.
    Нужно для фильтра «по пользователю»."""
    sql = """
        SELECT DISTINCT a.chat_id, e.full_name, e.short_name
        FROM audit_log a
        LEFT JOIN employees e ON e.telegram_id = a.chat_id
        WHERE a.created_at >= ? AND a.created_at <= ?
          AND a.chat_id IS NOT NULL
        ORDER BY e.full_name
    """
    return await _fetch_all(
        sql,
        (date_from + " 00:00:00", date_to + " 23:59:59"),
    )


# ============ КОЛИЧЕСТВЕННЫЕ ХЕЛПЕРЫ ============


async def count_active_models() -> int:
    return await _fetch_scalar(
        "SELECT COUNT(*) FROM models WHERE is_active = 1"
    ) or 0


async def count_active_employees() -> int:
    return await _fetch_scalar(
        "SELECT COUNT(*) FROM employees WHERE is_active = 1"
    ) or 0


async def count_assemblies_by_date(date_str: str) -> int:
    return await _fetch_scalar(
        "SELECT COUNT(*) FROM assemblies WHERE assembly_date = ? AND is_active = 1",
        (date_str,),
    ) or 0


# ============================================================================
# ЭТАП 13: КОНТРАГЕНТЫ (CRUD)
# ============================================================================


async def get_contractors(
    only_active: bool = True,
    contractor_type: str | None = None,
    search: str | None = None,
) -> list[dict]:
    """Список контрагентов с фильтрами.

    - only_active: исключать архивных
    - contractor_type: 'legal' | 'private' | None (все)
    - search: подстрока в name/inn/phone/contact_person
    """
    where = []
    params: list = []
    if only_active:
        where.append("is_active = 1")
    if contractor_type:
        where.append("contractor_type = ?")
        params.append(contractor_type)
    if search:
        like = f"%{search.lower()}%"
        where.append(
            "(LOWER(name) LIKE ? OR LOWER(COALESCE(inn, '')) LIKE ? "
            "OR LOWER(COALESCE(phone, '')) LIKE ? "
            "OR LOWER(COALESCE(contact_person, '')) LIKE ?)"
        )
        params.extend([like, like, like, like])

    sql = "SELECT * FROM contractors"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY name COLLATE NOCASE"
    return await _fetch_all(sql, tuple(params))


async def get_contractor_by_id(contractor_id: int) -> dict | None:
    return await _fetch_one(
        "SELECT * FROM contractors WHERE id = ?", (contractor_id,)
    )


async def create_contractor(
    name: str,
    contractor_type: str = "legal",
    inn: str | None = None,
    phone: str | None = None,
    contact_person: str | None = None,
    address: str | None = None,
    comment: str | None = None,
    created_by_chat_id: int | None = None,
) -> int:
    """Создаёт нового контрагента. Возвращает ID."""
    return await _execute(
        """INSERT INTO contractors
           (name, contractor_type, inn, phone, contact_person, address, comment,
            created_by_chat_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            name.strip(),
            contractor_type,
            (inn or "").strip() or None,
            (phone or "").strip() or None,
            (contact_person or "").strip() or None,
            (address or "").strip() or None,
            (comment or "").strip() or None,
            created_by_chat_id,
        ),
    )


async def update_contractor(
    contractor_id: int,
    name: str | None = None,
    contractor_type: str | None = None,
    inn: str | None = None,
    phone: str | None = None,
    contact_person: str | None = None,
    address: str | None = None,
    comment: str | None = None,
    updated_by_chat_id: int | None = None,
) -> bool:
    """Обновляет только переданные (не-None) поля."""
    current = await get_contractor_by_id(contractor_id)
    if not current:
        return False

    fields = []
    values: list[Any] = []
    for col, val in [
        ("name", name.strip() if name is not None else None),
        ("contractor_type", contractor_type),
        ("inn", inn.strip() if inn is not None else None),
        ("phone", phone.strip() if phone is not None else None),
        ("contact_person", contact_person.strip() if contact_person is not None else None),
        ("address", address.strip() if address is not None else None),
        ("comment", comment.strip() if comment is not None else None),
    ]:
        if val is not None:
            fields.append(f"{col} = ?")
            values.append(val if val != "" else None)

    if not fields:
        return True

    fields.append("updated_at = datetime('now')")
    if updated_by_chat_id is not None:
        fields.append("updated_by_chat_id = ?")
        values.append(updated_by_chat_id)
    values.append(contractor_id)

    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            f"UPDATE contractors SET {', '.join(fields)} WHERE id = ?",
            tuple(values),
        )
        await conn.commit()
    return True


async def set_contractor_active(contractor_id: int, is_active: bool) -> bool:
    """Soft-delete: контрагент остаётся в БД, но скрыт из списков."""
    await _execute(
        "UPDATE contractors SET is_active = ?, updated_at = datetime('now') "
        "WHERE id = ?",
        (1 if is_active else 0, contractor_id),
    )
    return True


async def count_contracts_for_contractor(contractor_id: int) -> dict:
    """Количество активных/закрытых договоров у контрагента.

    Возвращает: {'active': N, 'closed': M}
    """
    rows = await _fetch_all(
        "SELECT status, COUNT(*) AS cnt FROM contracts "
        "WHERE contractor_id = ? AND is_active = 1 GROUP BY status",
        (contractor_id,),
    )
    active = 0
    closed = 0
    for r in rows:
        if r["status"] == "closed":
            closed = r["cnt"]
        else:
            active += r["cnt"]
    return {"active": active, "closed": closed}


# ============================================================================
# ЭТАП 13: ДОГОВОРЫ (CRUD)
# ============================================================================


async def get_contracts(
    only_active: bool = True,
    status: str | None = None,
    manager_id: int | None = None,
    contractor_id: int | None = None,
    search: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Список договоров с фильтрами и JOIN на contractors+employees.

    Каждая запись содержит:
    - все поля contracts.*
    - contractor_name, contractor_inn, contractor_phone (из contractors)
    - manager_name (short_name из employees)
    """
    where = []
    params: list = []
    if only_active:
        where.append("c.is_active = 1")
    if status:
        where.append("c.status = ?")
        params.append(status)
    if manager_id:
        where.append("c.manager_id = ?")
        params.append(manager_id)
    if contractor_id:
        where.append("c.contractor_id = ?")
        params.append(contractor_id)
    if search:
        like = f"%{search.lower()}%"
        where.append(
            "(LOWER(c.number) LIKE ? OR LOWER(co.name) LIKE ? "
            "OR LOWER(COALESCE(c.comment, '')) LIKE ?)"
        )
        params.extend([like, like, like])

    sql = """
        SELECT
            c.*,
            co.name AS contractor_name,
            co.inn AS contractor_inn,
            co.phone AS contractor_phone,
            co.contractor_type AS contractor_type_full,
            emp.short_name AS manager_name,
            emp.full_name AS manager_full_name,
            emp.phone AS manager_phone,
            emp.email AS manager_email
        FROM contracts c
        LEFT JOIN contractors co ON co.id = c.contractor_id
        LEFT JOIN employees emp ON emp.id = c.manager_id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY c.sign_date DESC, c.id DESC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return await _fetch_all(sql, tuple(params))


async def get_contract_by_id(contract_id: int) -> dict | None:
    """Один договор с JOIN на контрагента и менеджера."""
    return await _fetch_one(
        """SELECT
            c.*,
            co.name AS contractor_name,
            co.inn AS contractor_inn,
            co.phone AS contractor_phone,
            co.contact_person AS contractor_contact_person,
            co.address AS contractor_address,
            co.contractor_type AS contractor_type_full,
            emp.short_name AS manager_name,
            emp.full_name AS manager_full_name,
            emp.phone AS manager_phone,
            emp.email AS manager_email
        FROM contracts c
        LEFT JOIN contractors co ON co.id = c.contractor_id
        LEFT JOIN employees emp ON emp.id = c.manager_id
        WHERE c.id = ?""",
        (contract_id,),
    )


async def create_contract(
    number: str,
    sign_date: str,
    contractor_id: int,
    contract_type: str = "supply",
    status: str = "production",
    legal_entity: str = "ooo_atomus",
    sum_amount: float | None = None,
    delivery_date: str | None = None,
    delivery_address: str | None = None,
    manager_id: int | None = None,
    comment: str | None = None,
    created_by_chat_id: int | None = None,
) -> int:
    """Создаёт новый договор. Возвращает ID.

    ЭТАП 21: При создании сразу генерируется public_token для QR-кода.
    """
    import secrets
    public_token = secrets.token_urlsafe(8)
    return await _execute(
        """INSERT INTO contracts
           (number, sign_date, contractor_id, contract_type, status, legal_entity,
            sum_amount, delivery_date, delivery_address, manager_id, comment,
            public_token, created_by_chat_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            number.strip(),
            sign_date,
            contractor_id,
            contract_type,
            status,
            legal_entity,
            sum_amount,
            delivery_date,
            (delivery_address or "").strip() or None,
            manager_id,
            (comment or "").strip() or None,
            public_token,
            created_by_chat_id,
        ),
    )


async def update_contract(
    contract_id: int,
    number: str | None = None,
    sign_date: str | None = None,
    contractor_id: int | None = None,
    contract_type: str | None = None,
    status: str | None = None,
    legal_entity: str | None = None,
    sum_amount: float | None = None,
    delivery_date: str | None = None,
    delivery_address: str | None = None,
    manager_id: int | None = None,
    comment: str | None = None,
    updated_by_chat_id: int | None = None,
) -> bool:
    """Обновляет только переданные (не-None) поля договора."""
    current = await _fetch_one("SELECT * FROM contracts WHERE id = ?", (contract_id,))
    if not current:
        return False

    fields = []
    values: list[Any] = []
    for col, val in [
        ("number", number.strip() if number is not None else None),
        ("sign_date", sign_date),
        ("contractor_id", contractor_id),
        ("contract_type", contract_type),
        ("status", status),
        ("legal_entity", legal_entity),
        ("sum_amount", sum_amount),
        ("delivery_date", delivery_date),
        ("delivery_address", delivery_address.strip() if delivery_address is not None else None),
        ("manager_id", manager_id),
        ("comment", comment.strip() if comment is not None else None),
    ]:
        if val is not None:
            fields.append(f"{col} = ?")
            # Пустая строка → NULL для опциональных полей
            if isinstance(val, str) and val == "":
                values.append(None)
            else:
                values.append(val)

    if not fields:
        return True

    fields.append("updated_at = datetime('now')")
    if updated_by_chat_id is not None:
        fields.append("updated_by_chat_id = ?")
        values.append(updated_by_chat_id)
    values.append(contract_id)

    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            f"UPDATE contracts SET {', '.join(fields)} WHERE id = ?",
            tuple(values),
        )
        await conn.commit()
    return True


async def set_contract_active(contract_id: int, is_active: bool) -> bool:
    """Soft-delete договора."""
    await _execute(
        "UPDATE contracts SET is_active = ?, updated_at = datetime('now') "
        "WHERE id = ?",
        (1 if is_active else 0, contract_id),
    )
    return True


async def count_contracts_by_status() -> dict:
    """Подсчёт активных договоров по каждому статусу.

    Возвращает: {'production': N, 'ready': M, 'shipped': K, 'closed': L, 'total': S}
    """
    rows = await _fetch_all(
        "SELECT status, COUNT(*) AS cnt FROM contracts "
        "WHERE is_active = 1 GROUP BY status"
    )
    result = {"production": 0, "ready": 0, "shipped": 0, "closed": 0, "total": 0}
    for r in rows:
        s = r["status"]
        if s in result:
            result[s] = r["cnt"]
        result["total"] += r["cnt"]
    return result


# ============================================================================
# ЭТАП 13: РАСШИРЕННАЯ РАБОТА С СОТРУДНИКАМИ (для PWA)
# ============================================================================


async def get_employee_by_phone(phone: str) -> dict | None:
    """Найти сотрудника по телефону (для проверки уникальности)."""
    return await _fetch_one(
        "SELECT * FROM employees WHERE phone = ? AND is_active = 1", (phone,)
    )


async def get_employee_by_tab_number(tab_number: str) -> dict | None:
    return await _fetch_one(
        "SELECT * FROM employees WHERE tab_number = ? AND is_active = 1",
        (tab_number,),
    )


async def get_employees_with_role(role: str) -> list[dict]:
    """Возвращает активных сотрудников у которых есть указанная роль.

    Использует SQL LIKE с проверкой на запятые, чтобы не ловить 'manager' внутри 'submanager'.
    """
    rows = await _fetch_all(
        "SELECT * FROM employees WHERE is_active = 1 ORDER BY full_name"
    )
    result = []
    for r in rows:
        roles_str = r.get("roles") or ""
        roles = {p.strip() for p in roles_str.split(",") if p.strip()}
        if role in roles:
            result.append(r)
    return result


# ============ v2.8.2: СПРАВОЧНИК ДОЛЖНОСТЕЙ ============


async def get_positions(include_inactive: bool = False) -> list[dict]:
    """Список должностей. По умолчанию — только активные."""
    if include_inactive:
        return await _fetch_all(
            "SELECT * FROM positions ORDER BY sort_order, name"
        )
    return await _fetch_all(
        "SELECT * FROM positions WHERE is_active = 1 ORDER BY sort_order, name"
    )


async def get_position_by_id(pos_id: int) -> dict | None:
    return await _fetch_one("SELECT * FROM positions WHERE id = ?", (pos_id,))


async def get_position_by_name(name: str) -> dict | None:
    """COLLATE NOCASE — поиск без учёта регистра."""
    return await _fetch_one(
        "SELECT * FROM positions WHERE name = ? COLLATE NOCASE", (name,)
    )


async def create_position(name: str, sort_order: int = 100) -> int:
    """Создаёт должность. Возвращает id или 0 если такое имя уже есть."""
    existing = await get_position_by_name(name)
    if existing:
        return 0
    return await _execute(
        "INSERT INTO positions (name, sort_order) VALUES (?, ?)",
        (name.strip(), sort_order),
    )


async def update_position(pos_id: int, name: str | None = None,
                          sort_order: int | None = None) -> bool:
    """Обновляет должность. Если name занят другой записью — возвращает False."""
    current = await get_position_by_id(pos_id)
    if not current:
        return False
    fields = []
    values: list[Any] = []
    if name is not None and name.strip():
        # Уникальность среди других записей
        dup = await get_position_by_name(name.strip())
        if dup and dup["id"] != pos_id:
            return False
        fields.append("name = ?")
        values.append(name.strip())
    if sort_order is not None:
        fields.append("sort_order = ?")
        values.append(int(sort_order))
    if not fields:
        return True
    fields.append("updated_at = datetime('now')")
    values.append(pos_id)
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            f"UPDATE positions SET {', '.join(fields)} WHERE id = ?",
            tuple(values),
        )
        await conn.commit()
    return True


async def delete_position(pos_id: int) -> bool:
    """Soft-delete должности (is_active=0). Должность с историей сотрудников
    не теряется — текстовые значения в employees.position остаются как были."""
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            "UPDATE positions SET is_active = 0, updated_at = datetime('now') WHERE id = ?",
            (pos_id,),
        )
        await conn.commit()
    return True


async def restore_position(pos_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            "UPDATE positions SET is_active = 1, updated_at = datetime('now') WHERE id = ?",
            (pos_id,),
        )
        await conn.commit()
    return True


async def count_employees_with_position(name: str) -> int:
    """Сколько активных сотрудников используют такую должность (по имени, без учёта регистра)."""
    return await _fetch_scalar(
        "SELECT COUNT(*) FROM employees WHERE is_active = 1 AND LOWER(position) = LOWER(?)",
        (name,),
    ) or 0


# ============ ЭТАП 29: УРОВНИ ДОСТУПА (CRUD) ============


def _parse_perms(s: str | None) -> list[str]:
    """Парсит строку permissions в список ключей."""
    if not s:
        return []
    keys = [p.strip() for p in s.split(",") if p.strip()]
    # Фильтруем только известные ключи (защита от мусора в БД)
    return [k for k in keys if k in ALL_PERMISSION_KEYS]


def _serialize_level(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row.get("name") or "",
        "permissions": _parse_perms(row.get("permissions")),
        "sort_order": row.get("sort_order") or 100,
        "is_system": bool(row.get("is_system")),
        "is_active": bool(row.get("is_active")),
    }


async def get_access_levels(include_inactive: bool = False) -> list[dict]:
    if include_inactive:
        rows = await _fetch_all(
            "SELECT * FROM access_levels ORDER BY sort_order, name"
        )
    else:
        rows = await _fetch_all(
            "SELECT * FROM access_levels WHERE is_active = 1 ORDER BY sort_order, name"
        )
    return [_serialize_level(r) for r in rows]


async def get_access_level_by_id(level_id: int) -> dict | None:
    row = await _fetch_one("SELECT * FROM access_levels WHERE id = ?", (level_id,))
    return _serialize_level(row) if row else None


async def get_access_level_by_name(name: str) -> dict | None:
    row = await _fetch_one(
        "SELECT * FROM access_levels WHERE name = ? COLLATE NOCASE", (name,)
    )
    return _serialize_level(row) if row else None


async def create_access_level(name: str, permissions: list[str],
                              sort_order: int = 100) -> int:
    """Создаёт новый уровень. Возвращает id или 0 если имя занято."""
    existing = await get_access_level_by_name(name)
    if existing:
        return 0
    # Фильтруем permissions — только известные
    valid = [p for p in permissions if p in ALL_PERMISSION_KEYS]
    perms_str = ",".join(sorted(set(valid)))
    return await _execute(
        "INSERT INTO access_levels (name, permissions, sort_order, is_system) VALUES (?, ?, ?, 0)",
        (name.strip(), perms_str, int(sort_order)),
    )


async def update_access_level(level_id: int,
                              name: str | None = None,
                              permissions: list[str] | None = None,
                              sort_order: int | None = None) -> tuple[bool, str]:
    """Обновляет уровень. Возвращает (ok, error_code).
    error_code: '' если ok, 'not_found', 'duplicate', 'system_locked' (если меняют имя системного).
    """
    current = await get_access_level_by_id(level_id)
    if not current:
        return False, "not_found"

    fields = []
    values: list[Any] = []

    if name is not None and name.strip() and name.strip() != current["name"]:
        # Системные уровни не дают переименовать (чтобы привязка по имени в коде работала)
        if current["is_system"]:
            return False, "system_locked"
        dup = await get_access_level_by_name(name.strip())
        if dup and dup["id"] != level_id:
            return False, "duplicate"
        fields.append("name = ?")
        values.append(name.strip())

    if permissions is not None:
        valid = [p for p in permissions if p in ALL_PERMISSION_KEYS]
        fields.append("permissions = ?")
        values.append(",".join(sorted(set(valid))))

    if sort_order is not None:
        fields.append("sort_order = ?")
        values.append(int(sort_order))

    if not fields:
        return True, ""

    fields.append("updated_at = datetime('now')")
    values.append(level_id)

    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            f"UPDATE access_levels SET {', '.join(fields)} WHERE id = ?",
            tuple(values),
        )
        await conn.commit()
    return True, ""


async def delete_access_level(level_id: int) -> tuple[bool, str]:
    """Soft-delete. Системные нельзя удалять. С привязанными сотрудниками — нельзя."""
    current = await get_access_level_by_id(level_id)
    if not current:
        return False, "not_found"
    if current["is_system"]:
        return False, "system_locked"
    cnt = await count_employees_with_access_level(level_id)
    if cnt > 0:
        return False, "in_use"
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            "UPDATE access_levels SET is_active = 0, updated_at = datetime('now') WHERE id = ?",
            (level_id,),
        )
        await conn.commit()
    return True, ""


async def count_employees_with_access_level(level_id: int) -> int:
    return await _fetch_scalar(
        "SELECT COUNT(*) FROM employees WHERE is_active = 1 AND access_level_id = ?",
        (level_id,),
    ) or 0


async def get_employee_permissions(emp_id: int) -> set[str]:
    """Получить набор permissions сотрудника через его уровень доступа."""
    row = await _fetch_one(
        """SELECT al.permissions FROM employees e
           LEFT JOIN access_levels al ON al.id = e.access_level_id
           WHERE e.id = ?""",
        (emp_id,),
    )
    if not row or not row.get("permissions"):
        return set()
    return set(_parse_perms(row["permissions"]))


async def get_permissions_by_chat_id(chat_id: int) -> set[str]:
    """Получить permissions сотрудника по его chat_id (telegram_id или auth_chat_id)."""
    row = await _fetch_one(
        """SELECT al.permissions FROM employees e
           LEFT JOIN access_levels al ON al.id = e.access_level_id
           WHERE e.is_active = 1
             AND (e.telegram_id = ? OR e.auth_chat_id = ?)""",
        (chat_id, chat_id),
    )
    if not row or not row.get("permissions"):
        return set()
    return set(_parse_perms(row["permissions"]))


async def get_effective_permissions(chat_id: int, legacy_roles: set[str]) -> set[str]:
    """v2.9.1: вернуть итоговый набор permissions с fallback'ом.

    Если у пользователя есть legacy-роль 'director' (владелец чата или сотрудник
    без привязанного уровня доступа) — выдаём все известные permissions.
    Это страховка от ситуации когда permissions пустые, но legacy-доступ есть.
    """
    perms = await get_permissions_by_chat_id(chat_id)
    if "director" in legacy_roles and not perms:
        perms = set(ALL_PERMISSION_KEYS)
    return perms


async def count_employees_with_perm(perm_key: str) -> int:
    """Сколько активных сотрудников имеют конкретное permission.
    Используется чтобы не оставить никого без 'hr.manage_access'."""
    rows = await _fetch_all(
        """SELECT al.permissions FROM employees e
           JOIN access_levels al ON al.id = e.access_level_id
           WHERE e.is_active = 1 AND al.is_active = 1"""
    )
    cnt = 0
    for r in rows:
        keys = set(_parse_perms(r.get("permissions")))
        if perm_key in keys:
            cnt += 1
    return cnt


async def update_employee_access_level(emp_id: int, level_id: int | None) -> bool:
    """Привязывает сотрудника к уровню (или отвязывает если level_id=None)."""
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            "UPDATE employees SET access_level_id = ?, updated_at = datetime('now') WHERE id = ?",
            (level_id, emp_id),
        )
        await conn.commit()
    return True


# ============ КОНЕЦ ЭТАПА 29 ============


# ============================================================================
# ЭТАП 14А: ПРОДАЖНАЯ НОМЕНКЛАТУРА (CRUD)
# ============================================================================


async def get_sale_products(
    only_active: bool = True,
    product_type: str | None = None,
    search: str | None = None,
    category_id: int | None = None,         # ЭТАП 17
) -> list[dict]:
    """Список продажных позиций с фильтрами."""
    where = []
    params: list = []
    if only_active:
        where.append("p.is_active = 1")
    if product_type:
        where.append("p.product_type = ?")
        params.append(product_type)
    if search:
        like = f"%{search.lower()}%"
        where.append("(LOWER(p.name) LIKE ? OR LOWER(COALESCE(p.description, '')) LIKE ?)")
        params.extend([like, like])
    if category_id is not None:
        if category_id == 0:
            # Спец-значение «без категории»
            where.append("p.category_id IS NULL")
        else:
            where.append("p.category_id = ?")
            params.append(category_id)

    sql = """SELECT p.*, c.name AS category_name
             FROM sale_products p
             LEFT JOIN sale_categories c ON c.id = p.category_id"""
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY c.sort_order, c.name COLLATE NOCASE, p.sort_order, p.name COLLATE NOCASE"
    return await _fetch_all(sql, tuple(params))


async def get_sale_product_by_id(product_id: int) -> dict | None:
    """Одна позиция со списком связанных сборочных моделей."""
    product = await _fetch_one(
        """SELECT p.*, c.name AS category_name
           FROM sale_products p
           LEFT JOIN sale_categories c ON c.id = p.category_id
           WHERE p.id = ?""",
        (product_id,),
    )
    if not product:
        return None
    # Связанные сборочные модели
    links = await _fetch_all(
        """SELECT spm.model_id, spm.qty_per_product,
                  m.name AS model_name, m.extra AS model_extra,
                  m.article AS model_article,
                  d.name AS direction_name
           FROM sale_product_models spm
           JOIN models m ON m.id = spm.model_id
           LEFT JOIN directions d ON d.id = m.direction_id
           WHERE spm.sale_product_id = ?
           ORDER BY m.name""",
        (product_id,),
    )
    product["linked_models"] = links
    return product


async def create_sale_product(
    name: str,
    product_type: str = "goods",
    description: str | None = None,
    base_price: float | None = None,
    unit: str = "шт.",
    category_id: int | None = None,         # ЭТАП 17
    linked_model_ids: list[int] | None = None,
    created_by_chat_id: int | None = None,
) -> int:
    """Создаёт продажную позицию + опциональные связи со сборками."""
    new_id = await _execute(
        """INSERT INTO sale_products
           (name, description, product_type, base_price, unit, category_id, created_by_chat_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            name.strip(),
            (description or "").strip() or None,
            product_type,
            base_price,
            unit,
            category_id,
            created_by_chat_id,
        ),
    )
    # Привязки к сборкам
    if linked_model_ids:
        async with aiosqlite.connect(DB_PATH) as conn:
            for mid in linked_model_ids:
                try:
                    await conn.execute(
                        "INSERT OR IGNORE INTO sale_product_models "
                        "(sale_product_id, model_id, qty_per_product) VALUES (?, ?, 1)",
                        (new_id, int(mid)),
                    )
                except Exception:
                    pass
            await conn.commit()
    return new_id


async def update_sale_product(
    product_id: int,
    name: str | None = None,
    description: str | None = None,
    product_type: str | None = None,
    base_price: float | None = None,
    unit: str | None = None,
    category_id: int | None = None,         # ЭТАП 17
    set_category: bool = False,             # явный флаг для сброса в None
    linked_model_ids: list[int] | None = None,
    updated_by_chat_id: int | None = None,
) -> bool:
    """Обновляет позицию + при необходимости переписывает привязки моделей."""
    current = await _fetch_one("SELECT * FROM sale_products WHERE id = ?", (product_id,))
    if not current:
        return False

    fields = []
    values: list[Any] = []
    for col, val in [
        ("name", name.strip() if name is not None else None),
        ("description", description.strip() if description is not None else None),
        ("product_type", product_type),
        ("base_price", base_price),
        ("unit", unit),
    ]:
        if val is not None:
            fields.append(f"{col} = ?")
            if isinstance(val, str) and val == "":
                values.append(None)
            else:
                values.append(val)

    # ЭТАП 17: category_id обрабатываем отдельно (можно явно сбросить в None)
    if set_category:
        fields.append("category_id = ?")
        values.append(category_id)

    if fields:
        fields.append("updated_at = datetime('now')")
        if updated_by_chat_id is not None:
            fields.append("updated_by_chat_id = ?")
            values.append(updated_by_chat_id)
        values.append(product_id)
        async with aiosqlite.connect(DB_PATH) as conn:
            await conn.execute(
                f"UPDATE sale_products SET {', '.join(fields)} WHERE id = ?",
                tuple(values),
            )
            await conn.commit()

    # Если переданы привязки — полностью переписываем
    if linked_model_ids is not None:
        async with aiosqlite.connect(DB_PATH) as conn:
            await conn.execute(
                "DELETE FROM sale_product_models WHERE sale_product_id = ?",
                (product_id,),
            )
            for mid in linked_model_ids:
                try:
                    await conn.execute(
                        "INSERT OR IGNORE INTO sale_product_models "
                        "(sale_product_id, model_id, qty_per_product) VALUES (?, ?, 1)",
                        (product_id, int(mid)),
                    )
                except Exception:
                    pass
            await conn.commit()

    return True


async def set_sale_product_active(product_id: int, is_active: bool) -> bool:
    """Soft-delete продажной позиции."""
    await _execute(
        "UPDATE sale_products SET is_active = ?, updated_at = datetime('now') "
        "WHERE id = ?",
        (1 if is_active else 0, product_id),
    )
    return True


async def count_sale_products() -> dict:
    """Количество активных по типам: {'goods': N, 'service': M, 'total': S}"""
    rows = await _fetch_all(
        "SELECT product_type, COUNT(*) AS cnt FROM sale_products "
        "WHERE is_active = 1 GROUP BY product_type"
    )
    result = {"goods": 0, "service": 0, "total": 0}
    for r in rows:
        t = r["product_type"]
        if t in result:
            result[t] = r["cnt"]
        result["total"] += r["cnt"]
    return result


# ============================================================================
# ЭТАП 14Б: КОММЕРЧЕСКИЕ ПРЕДЛОЖЕНИЯ — КП (CRUD)
# ============================================================================


def manager_initials(full_name: str) -> str:
    """ФИО → 2 буквы. 'Подкорытов Дмитрий Сергеевич' → 'ПД' (Фамилия + Имя)."""
    if not full_name:
        return "XX"
    parts = full_name.strip().split()
    if len(parts) >= 2:
        return (parts[0][0] + parts[1][0]).upper()
    if parts:
        return (parts[0][:2]).upper()
    return "XX"


async def get_next_offer_seq_for_manager(manager_id: int) -> int:
    """Следующий порядковый номер КП у этого менеджера.

    Считаем max(seq_number) среди всех КП этого менеджера + 1.
    Версии не считаются отдельно — у одного base_number один seq.
    """
    row = await _fetch_one(
        "SELECT MAX(seq_number) AS mx FROM sale_offers "
        "WHERE manager_id = ?",
        (manager_id,),
    )
    if not row or row.get("mx") is None:
        return 1
    return int(row["mx"]) + 1


def build_offer_numbers(seq: int, initials: str, today_date: str | None = None) -> tuple[str, str]:
    """Возвращает (base_number, full_number_v1).

    Пример: seq=18, initials=ПД, today=2026-05-12 →
        base_number = "КП-018-ПД-12.05"
        full_v1     = "КП-018-ПД-12.05.v1"
    """
    from datetime import date as _date
    if today_date:
        try:
            yyyy, mm, dd = today_date.split("-")
            d_part = f"{dd}.{mm}"
        except ValueError:
            d_part = _date.today().strftime("%d.%m")
    else:
        d_part = _date.today().strftime("%d.%m")
    base = f"КП-{seq:03d}-{initials}-{d_part}"
    full_v1 = f"{base}.v1"
    return base, full_v1


async def get_max_version_for_base(base_number: str) -> int:
    """Максимальная версия КП с этим base_number (для создания новой версии)."""
    row = await _fetch_one(
        "SELECT MAX(version) AS mx FROM sale_offers WHERE base_number = ?",
        (base_number,),
    )
    if not row or row.get("mx") is None:
        return 0
    return int(row["mx"])


async def get_sale_offers(
    only_active: bool = True,
    only_latest_versions: bool = True,
    status: str | None = None,
    manager_id: int | None = None,
    contractor_id: int | None = None,
    search: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Список КП с фильтрами.

    only_latest_versions=True: возвращаем только МАКСИМАЛЬНУЮ версию каждого base_number.
    Это нужно для основного списка КП (где не хотим видеть старые версии).
    """
    where = []
    params: list = []
    if only_active:
        where.append("o.is_active = 1")
    if status:
        where.append("o.status = ?")
        params.append(status)
    if manager_id:
        where.append("o.manager_id = ?")
        params.append(manager_id)
    if contractor_id:
        where.append("o.contractor_id = ?")
        params.append(contractor_id)
    if search:
        like = f"%{search.lower()}%"
        where.append(
            "(LOWER(o.number) LIKE ? OR LOWER(co.name) LIKE ? "
            "OR LOWER(COALESCE(o.comment_client, '')) LIKE ?)"
        )
        params.extend([like, like, like])

    if only_latest_versions:
        # Subquery: для каждого base_number — max version
        sql = """
            SELECT
                o.*,
                co.name AS contractor_name,
                co.inn AS contractor_inn,
                co.phone AS contractor_phone,
                emp.short_name AS manager_name,
                emp.full_name AS manager_full_name,
                emp.phone AS manager_phone,
                emp.email AS manager_email
            FROM sale_offers o
            LEFT JOIN contractors co ON co.id = o.contractor_id
            LEFT JOIN employees emp ON emp.id = o.manager_id
            INNER JOIN (
                SELECT base_number, MAX(version) AS max_v
                FROM sale_offers WHERE is_active = 1
                GROUP BY base_number
            ) mx ON mx.base_number = o.base_number AND mx.max_v = o.version
        """
    else:
        sql = """
            SELECT
                o.*,
                co.name AS contractor_name,
                co.inn AS contractor_inn,
                co.phone AS contractor_phone,
                emp.short_name AS manager_name,
                emp.full_name AS manager_full_name,
                emp.phone AS manager_phone,
                emp.email AS manager_email
            FROM sale_offers o
            LEFT JOIN contractors co ON co.id = o.contractor_id
            LEFT JOIN employees emp ON emp.id = o.manager_id
        """

    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY o.created_at DESC, o.id DESC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return await _fetch_all(sql, tuple(params))


async def get_sale_offer_by_id(offer_id: int) -> dict | None:
    """Одно КП с JOIN и позициями."""
    offer = await _fetch_one(
        """SELECT
            o.*,
            co.name AS contractor_name,
            co.inn AS contractor_inn,
            co.phone AS contractor_phone,
            co.contact_person AS contractor_contact_person,
            co.address AS contractor_address,
            emp.short_name AS manager_name,
            emp.full_name AS manager_full_name,
            emp.phone AS manager_phone,
            emp.email AS manager_email
        FROM sale_offers o
        LEFT JOIN contractors co ON co.id = o.contractor_id
        LEFT JOIN employees emp ON emp.id = o.manager_id
        WHERE o.id = ?""",
        (offer_id,),
    )
    if not offer:
        return None
    # Позиции
    items = await _fetch_all(
        "SELECT * FROM sale_offer_items WHERE offer_id = ? ORDER BY sort_order, id",
        (offer_id,),
    )
    offer["items"] = items
    return offer


async def get_offer_versions_for_base(base_number: str) -> list[dict]:
    """Все версии КП с этим base_number (для истории версий)."""
    return await _fetch_all(
        """SELECT o.*, emp.short_name AS manager_name
           FROM sale_offers o
           LEFT JOIN employees emp ON emp.id = o.manager_id
           WHERE o.base_number = ? AND o.is_active = 1
           ORDER BY o.version DESC""",
        (base_number,),
    )


def _calculate_line_total(qty: float, price: float, discount_pct: float) -> float:
    """qty * price * (1 - discount_pct/100). С округлением до копеек."""
    d = max(0.0, min(100.0, float(discount_pct or 0)))
    total = float(qty or 0) * float(price or 0) * (1 - d / 100)
    return round(total, 2)


def _calc_valid_until(value: int, unit: str) -> str:
    """Рассчитывает дату окончания действия КП от сегодня.

    ЭТАП 16А: используется при создании/обновлении КП когда указана длительность.

    Args:
        value: число (например 14)
        unit: 'days' | 'weeks' | 'months'

    Returns:
        YYYY-MM-DD
    """
    from datetime import date, timedelta
    today = date.today()
    v = int(value or 0)
    if v <= 0:
        v = 1
    if unit == "weeks":
        delta = timedelta(days=v * 7)
    elif unit == "months":
        # Простой расчёт: 30 дней на месяц (достаточно для КП)
        delta = timedelta(days=v * 30)
    else:  # days по умолчанию
        delta = timedelta(days=v)
    return (today + delta).isoformat()


def valid_duration_label(value: int | None, unit: str | None) -> str:
    """Возвращает человекочитаемое описание длительности: '14 дней', '2 недели', '1 месяц'.

    Используется в PDF и UI.
    """
    if not value:
        return ""
    v = int(value)
    if v <= 0:
        return ""
    if unit == "weeks":
        if v == 1:
            return "1 неделя"
        if 2 <= v <= 4:
            return f"{v} недели"
        return f"{v} недель"
    if unit == "months":
        if v == 1:
            return "1 месяц"
        if 2 <= v <= 4:
            return f"{v} месяца"
        return f"{v} месяцев"
    # days
    if v == 1:
        return "1 день"
    if 2 <= v <= 4:
        return f"{v} дня"
    return f"{v} дней"


def production_days_label(days: int | None) -> str:
    """ЭТАП 16А-2: '20 рабочих дней' / '1 рабочий день'."""
    if not days:
        return ""
    v = int(days)
    if v <= 0:
        return ""
    a = v % 10
    b = v % 100
    if b >= 11 and b <= 14:
        return f"{v} рабочих дней"
    if a == 1:
        return f"{v} рабочий день"
    if 2 <= a <= 4:
        return f"{v} рабочих дня"
    return f"{v} рабочих дней"


async def create_sale_offer(
    manager_id: int,
    contractor_id: int,
    legal_entity: str = "ooo_atomus",
    valid_until: str | None = None,
    valid_duration_value: int | None = None,    # ЭТАП 16А: число
    valid_duration_unit: str | None = None,     # ЭТАП 16А: 'days'|'weeks'|'months'
    production_term: str | None = None,
    production_days: int | None = None,         # ЭТАП 16А-2: срок изготовления в рабочих днях
    payment_terms: str | None = None,
    delivery_terms: str | None = None,
    comment_internal: str | None = None,
    comment_client: str | None = None,
    items: list[dict] | None = None,
    created_by_chat_id: int | None = None,
) -> int:
    """Создаёт новое КП (всегда версия 1).

    items: список словарей с полями:
        sale_product_id (опционально), name, description, unit, qty, price, discount_pct

    Срок действия можно задать двумя способами:
    - valid_until — конкретная дата (старый способ, для совместимости)
    - valid_duration_value + valid_duration_unit — длительность от даты создания
      (новый способ Этапа 16А; valid_until будет посчитан автоматически)
    """
    # Получаем инициалы менеджера для номера
    manager = await get_employee_by_id(manager_id)
    if not manager:
        raise ValueError("Менеджер не найден")

    initials = manager_initials(manager.get("full_name") or "")
    seq = await get_next_offer_seq_for_manager(manager_id)
    base_number, full_v1 = build_offer_numbers(seq, initials)

    # Считаем итоговую сумму
    items = items or []
    total_sum = 0.0
    for it in items:
        lt = _calculate_line_total(
            it.get("qty") or 1,
            it.get("price") or 0,
            it.get("discount_pct") or 0,
        )
        it["line_total"] = lt
        total_sum += lt

    # Если задан срок длительностью — авторасчёт valid_until
    if valid_duration_value and valid_duration_unit and not valid_until:
        valid_until = _calc_valid_until(valid_duration_value, valid_duration_unit)

    # Создаём
    async with aiosqlite.connect(DB_PATH) as conn:
        cur = await conn.execute(
            """INSERT INTO sale_offers
               (number, base_number, version, seq_number, manager_id, contractor_id,
                legal_entity, status, valid_until, valid_duration_value, valid_duration_unit,
                production_term, production_days, payment_terms,
                delivery_terms, comment_internal, comment_client, total_sum,
                created_by_chat_id)
               VALUES (?, ?, 1, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                full_v1, base_number, seq, manager_id, contractor_id, legal_entity,
                valid_until, valid_duration_value, valid_duration_unit,
                production_term, production_days, payment_terms, delivery_terms,
                comment_internal, comment_client, round(total_sum, 2),
                created_by_chat_id,
            ),
        )
        new_id = cur.lastrowid
        # Позиции
        for i, it in enumerate(items):
            await conn.execute(
                """INSERT INTO sale_offer_items
                   (offer_id, sale_product_id, sort_order, name, description, unit,
                    qty, price, discount_pct, line_total)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    new_id,
                    it.get("sale_product_id"),
                    i,
                    (it.get("name") or "").strip(),
                    (it.get("description") or "").strip() or None,
                    it.get("unit") or "шт.",
                    float(it.get("qty") or 1),
                    float(it.get("price") or 0),
                    float(it.get("discount_pct") or 0),
                    it["line_total"],
                ),
            )
        await conn.commit()
    return new_id


async def update_sale_offer(
    offer_id: int,
    updated_by_chat_id: int | None = None,
    **fields,
) -> bool:
    """Обновляет КП БЕЗ создания новой версии. Используется для черновика.

    Поддерживаемые поля: contractor_id, legal_entity, valid_until, production_term,
    payment_terms, delivery_terms, comment_internal, comment_client, status, items.
    """
    current = await _fetch_one("SELECT * FROM sale_offers WHERE id = ?", (offer_id,))
    if not current:
        return False

    items = fields.pop("items", None)

    update_fields = []
    values: list[Any] = []
    allowed_cols = (
        "contractor_id", "legal_entity", "valid_until",
        "valid_duration_value", "valid_duration_unit",   # ЭТАП 16А
        "production_term", "production_days",            # ЭТАП 16А-2
        "payment_terms", "delivery_terms", "comment_internal", "comment_client",
        "status",
    )

    # ЭТАП 16А: если задана длительность но не дата — рассчитаем дату
    if (
        fields.get("valid_duration_value") is not None
        and fields.get("valid_duration_unit") is not None
        and fields.get("valid_until") is None
    ):
        fields["valid_until"] = _calc_valid_until(
            fields["valid_duration_value"], fields["valid_duration_unit"]
        )

    for col in allowed_cols:
        if col in fields and fields[col] is not None:
            update_fields.append(f"{col} = ?")
            val = fields[col]
            if isinstance(val, str) and val == "":
                values.append(None)
            else:
                values.append(val)

    # Пересчитываем total_sum если переданы позиции
    if items is not None:
        total_sum = 0.0
        for it in items:
            lt = _calculate_line_total(
                it.get("qty") or 1,
                it.get("price") or 0,
                it.get("discount_pct") or 0,
            )
            it["line_total"] = lt
            total_sum += lt
        update_fields.append("total_sum = ?")
        values.append(round(total_sum, 2))

    if update_fields:
        update_fields.append("updated_at = datetime('now')")
        if updated_by_chat_id is not None:
            update_fields.append("updated_by_chat_id = ?")
            values.append(updated_by_chat_id)
        values.append(offer_id)
        async with aiosqlite.connect(DB_PATH) as conn:
            await conn.execute(
                f"UPDATE sale_offers SET {', '.join(update_fields)} WHERE id = ?",
                tuple(values),
            )
            await conn.commit()

    # Если переданы items — полностью пересоздаём
    if items is not None:
        async with aiosqlite.connect(DB_PATH) as conn:
            await conn.execute(
                "DELETE FROM sale_offer_items WHERE offer_id = ?", (offer_id,)
            )
            for i, it in enumerate(items):
                await conn.execute(
                    """INSERT INTO sale_offer_items
                       (offer_id, sale_product_id, sort_order, name, description, unit,
                        qty, price, discount_pct, line_total)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        offer_id,
                        it.get("sale_product_id"),
                        i,
                        (it.get("name") or "").strip(),
                        (it.get("description") or "").strip() or None,
                        it.get("unit") or "шт.",
                        float(it.get("qty") or 1),
                        float(it.get("price") or 0),
                        float(it.get("discount_pct") or 0),
                        it["line_total"],
                    ),
                )
            await conn.commit()

    return True


async def create_offer_new_version(
    source_offer_id: int,
    updated_by_chat_id: int | None = None,
    **changes,
) -> int:
    """Создаёт новую версию КП на базе существующего.

    Берёт исходное КП, увеличивает version на 1, применяет changes (если есть),
    копирует позиции (с возможностью замены через changes['items']).
    """
    src = await get_sale_offer_by_id(source_offer_id)
    if not src:
        raise ValueError("Исходное КП не найдено")

    base_number = src["base_number"]
    next_version = await get_max_version_for_base(base_number) + 1
    new_full_number = f"{base_number}.v{next_version}"

    # Применяем changes к данным
    new_data = {
        "contractor_id": src["contractor_id"],
        "legal_entity": src["legal_entity"],
        "valid_until": src.get("valid_until"),
        "valid_duration_value": src.get("valid_duration_value"),    # ЭТАП 16А
        "valid_duration_unit": src.get("valid_duration_unit"),      # ЭТАП 16А
        "production_term": src.get("production_term"),
        "production_days": src.get("production_days"),              # ЭТАП 16А-2
        "payment_terms": src.get("payment_terms"),
        "delivery_terms": src.get("delivery_terms"),
        "comment_internal": src.get("comment_internal"),
        "comment_client": src.get("comment_client"),
    }
    for k, v in changes.items():
        if k != "items" and v is not None:
            new_data[k] = v

    # ЭТАП 16А: если у новой версии задана длительность — пересчитаем valid_until от сегодня
    if new_data.get("valid_duration_value") and new_data.get("valid_duration_unit"):
        new_data["valid_until"] = _calc_valid_until(
            new_data["valid_duration_value"], new_data["valid_duration_unit"]
        )

    # Позиции — либо новые из changes, либо копируем из исходника
    if "items" in changes and changes["items"] is not None:
        items = changes["items"]
    else:
        # Копируем существующие позиции
        items = []
        for it in (src.get("items") or []):
            items.append({
                "sale_product_id": it.get("sale_product_id"),
                "name": it.get("name") or "",
                "description": it.get("description"),
                "unit": it.get("unit") or "шт.",
                "qty": it.get("qty") or 1,
                "price": it.get("price") or 0,
                "discount_pct": it.get("discount_pct") or 0,
            })

    # Считаем total_sum
    total_sum = 0.0
    for it in items:
        lt = _calculate_line_total(
            it.get("qty") or 1, it.get("price") or 0, it.get("discount_pct") or 0
        )
        it["line_total"] = lt
        total_sum += lt

    async with aiosqlite.connect(DB_PATH) as conn:
        cur = await conn.execute(
            """INSERT INTO sale_offers
               (number, base_number, version, seq_number, manager_id, contractor_id,
                legal_entity, status, valid_until, valid_duration_value, valid_duration_unit,
                production_term, production_days, payment_terms,
                delivery_terms, comment_internal, comment_client, total_sum,
                created_by_chat_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                new_full_number, base_number, next_version, src["seq_number"],
                src["manager_id"], new_data["contractor_id"], new_data["legal_entity"],
                new_data.get("valid_until"),
                new_data.get("valid_duration_value"), new_data.get("valid_duration_unit"),
                new_data.get("production_term"), new_data.get("production_days"),
                new_data.get("payment_terms"), new_data.get("delivery_terms"),
                new_data.get("comment_internal"), new_data.get("comment_client"),
                round(total_sum, 2),
                updated_by_chat_id,
            ),
        )
        new_id = cur.lastrowid
        for i, it in enumerate(items):
            await conn.execute(
                """INSERT INTO sale_offer_items
                   (offer_id, sale_product_id, sort_order, name, description, unit,
                    qty, price, discount_pct, line_total)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    new_id, it.get("sale_product_id"), i,
                    (it.get("name") or "").strip(),
                    (it.get("description") or "").strip() or None,
                    it.get("unit") or "шт.",
                    float(it.get("qty") or 1),
                    float(it.get("price") or 0),
                    float(it.get("discount_pct") or 0),
                    it["line_total"],
                ),
            )
        await conn.commit()
    return new_id


async def set_offer_active(offer_id: int, is_active: bool) -> bool:
    """Soft-delete КП."""
    await _execute(
        "UPDATE sale_offers SET is_active = ?, updated_at = datetime('now') "
        "WHERE id = ?",
        (1 if is_active else 0, offer_id),
    )
    return True


async def count_offers_by_status() -> dict:
    """Подсчёт активных КП (последние версии) по статусам."""
    rows = await _fetch_all(
        """SELECT o.status, COUNT(*) AS cnt
           FROM sale_offers o
           INNER JOIN (
               SELECT base_number, MAX(version) AS mv
               FROM sale_offers WHERE is_active = 1
               GROUP BY base_number
           ) mx ON mx.base_number = o.base_number AND mx.mv = o.version
           WHERE o.is_active = 1
           GROUP BY o.status"""
    )
    result = {"draft": 0, "sent": 0, "accepted": 0, "rejected": 0, "total": 0}
    for r in rows:
        s = r["status"]
        if s in result:
            result[s] = r["cnt"]
        result["total"] += r["cnt"]
    return result


# ============================================================================
# ЭТАП 15: СВЯЗЬ СБОРОК С ДОГОВОРАМИ
# ============================================================================


async def get_active_contracts_for_picker() -> list[dict]:
    """Список активных договоров для выбора при создании сборки.

    Только статусы 'production' и 'ready' — те под которые ещё собирают.
    Включает контрагента и (если есть) менеджера.
    """
    return await _fetch_all(
        """SELECT
              c.id,
              c.number,
              c.status,
              c.sign_date,
              c.delivery_date,
              co.name AS contractor_name,
              emp.short_name AS manager_name
           FROM contracts c
           LEFT JOIN contractors co ON co.id = c.contractor_id
           LEFT JOIN employees emp ON emp.id = c.manager_id
           WHERE c.is_active = 1
             AND c.status IN ('production', 'ready')
           ORDER BY c.delivery_date ASC NULLS LAST, c.sign_date DESC"""
    )


async def get_assemblies_for_contract(contract_id: int, only_active: bool = True) -> list[dict]:
    """Сборки, привязанные к конкретному договору. Группированные (без разворота по сборщикам).

    Возвращает по одной записи на каждую сборку (не разворачивается на сборщиков).
    """
    where_active = "AND a.is_active = 1" if only_active else ""
    sql = f"""
        SELECT
            a.id, a.assembly_date, a.quantity, a.execution, a.ip_class, a.comment,
            a.created_at,
            m.id AS model_id, m.name AS model_name, m.article, m.extra AS model_extra,
            m.exec_label_st, m.exec_label_ne,
            d.name AS direction_name
        FROM assemblies a
        JOIN models m ON a.model_id = m.id
        JOIN directions d ON m.direction_id = d.id
        WHERE a.contract_id = ? {where_active}
        ORDER BY a.assembly_date DESC, a.id DESC
    """
    rows = await _fetch_all(sql, (contract_id,))
    # Для каждой сборки получим список сборщиков
    for r in rows:
        workers = await _fetch_all(
            """SELECT e.id, e.short_name, e.full_name
               FROM assembly_workers aw
               JOIN employees e ON aw.employee_id = e.id
               WHERE aw.assembly_id = ?""",
            (r["id"],),
        )
        r["workers"] = workers
    return rows


async def get_assembly_counts_for_contracts(contract_ids: list[int]) -> dict:
    """Подсчёт количества сборок (сумма quantity) для списка договоров.

    Возвращает: {contract_id: total_qty, ...}
    """
    if not contract_ids:
        return {}
    placeholders = ",".join("?" for _ in contract_ids)
    rows = await _fetch_all(
        f"""SELECT contract_id, SUM(quantity) AS total
            FROM assemblies
            WHERE is_active = 1
              AND contract_id IN ({placeholders})
            GROUP BY contract_id""",
        tuple(contract_ids),
    )
    return {r["contract_id"]: int(r["total"] or 0) for r in rows}


async def get_active_contracts_with_progress(
    only_for_manager_id: int | None = None,
) -> list[dict]:
    """Активные договоры (production / ready) с количеством собранных сборок.

    Для главной Продаж и главной Производства.
    Если only_for_manager_id указан — только договоры этого менеджера.
    """
    where_extra = ""
    params: list = []
    if only_for_manager_id:
        where_extra = " AND c.manager_id = ?"
        params.append(only_for_manager_id)

    rows = await _fetch_all(
        f"""SELECT
              c.id,
              c.number,
              c.status,
              c.sign_date,
              c.delivery_date,
              c.contract_type,
              c.legal_entity,
              c.sum_amount,
              co.name AS contractor_name,
              co.inn AS contractor_inn,
              emp.short_name AS manager_name,
              COALESCE((SELECT SUM(quantity) FROM assemblies a
                        WHERE a.contract_id = c.id AND a.is_active = 1), 0) AS assemblies_qty
           FROM contracts c
           LEFT JOIN contractors co ON co.id = c.contractor_id
           LEFT JOIN employees emp ON emp.id = c.manager_id
           WHERE c.is_active = 1
             AND c.status IN ('production', 'ready')
             {where_extra}
           ORDER BY
             CASE WHEN c.delivery_date IS NULL THEN 1 ELSE 0 END,
             c.delivery_date ASC,
             c.sign_date DESC""",
        tuple(params),
    )
    return rows


# ============================================================================
# ============ ЭТАП 16Б: ГЛАВНАЯ СТРАНИЦА — KPI ==============================
# ============================================================================

async def get_home_kpi() -> dict:
    """KPI плитки для главной страницы.

    Возвращает 4 числа:
      - contracts_active: договоры в статусе production + ready
      - offers_active: КП в статусе draft + sent (только последние версии)
      - assemblies_today: сборок сделано сегодня
      - offers_accepted_month_sum: сумма принятых КП за календарный месяц (RUB)
    """
    today = date.today().isoformat()
    month_start = date.today().replace(day=1).isoformat()

    # Договоры в работе
    contracts_row = await _fetch_one(
        """SELECT COUNT(*) AS cnt FROM contracts
           WHERE is_active = 1 AND status IN ('production', 'ready')"""
    )
    contracts_active = contracts_row["cnt"] if contracts_row else 0

    # КП в работе — только последние версии каждого base_number
    offers_row = await _fetch_one(
        """SELECT COUNT(*) AS cnt FROM sale_offers o
           INNER JOIN (
             SELECT base_number, MAX(version) AS max_v
             FROM sale_offers WHERE is_active = 1 GROUP BY base_number
           ) mx ON mx.base_number = o.base_number AND mx.max_v = o.version
           WHERE o.is_active = 1 AND o.status IN ('draft', 'sent')"""
    )
    offers_active = offers_row["cnt"] if offers_row else 0

    # Сборки за сегодня
    assemblies_row = await _fetch_one(
        """SELECT COALESCE(SUM(quantity), 0) AS qty FROM assemblies
           WHERE is_active = 1 AND assembly_date = ?""",
        (today,),
    )
    assemblies_today = assemblies_row["qty"] if assemblies_row else 0

    # Сумма принятых КП за текущий календарный месяц
    sum_row = await _fetch_one(
        """SELECT COALESCE(SUM(total_sum), 0) AS s FROM sale_offers o
           INNER JOIN (
             SELECT base_number, MAX(version) AS max_v
             FROM sale_offers WHERE is_active = 1 GROUP BY base_number
           ) mx ON mx.base_number = o.base_number AND mx.max_v = o.version
           WHERE o.is_active = 1 AND o.status = 'accepted'
             AND substr(o.updated_at, 1, 10) >= ?""",
        (month_start,),
    )
    offers_accepted_month_sum = float(sum_row["s"] or 0) if sum_row else 0.0

    return {
        "contracts_active": contracts_active,
        "offers_active": offers_active,
        "assemblies_today": assemblies_today,
        "offers_accepted_month_sum": offers_accepted_month_sum,
    }


# ============================================================================
# ============ ЭТАП 16В: ЗАДАЧИ С ПЛАНЁРКИ ===================================
# ============================================================================

TASK_PRIORITIES = ("low", "normal", "urgent")
TASK_PRIORITY_LABELS = {"low": "низкий", "normal": "обычный", "urgent": "срочный"}
TASK_STATUSES = ("new", "in_progress", "done", "cancelled")
TASK_STATUS_LABELS = {
    "new": "новая",
    "in_progress": "в работе",
    "done": "готова",
    "cancelled": "отменена",
}


async def create_task(
    title: str,
    description: str | None,
    assignee_id: int | None,
    creator_chat_id: int | None,
    deadline: str | None = None,
    priority: str = "normal",
    source: str | None = None,
    contract_id: int | None = None,        # ЭТАП 16В-2
) -> int:
    """Создаёт задачу. Статус по умолчанию 'new'.

    Returns: ID новой задачи.
    """
    if priority not in TASK_PRIORITIES:
        priority = "normal"
    return await _execute(
        """INSERT INTO tasks
           (title, description, assignee_id, creator_chat_id,
            deadline, priority, status, source, contract_id)
           VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)""",
        (title, description, assignee_id, creator_chat_id,
         deadline, priority, source, contract_id),
    )


async def update_task(
    task_id: int,
    **fields,
) -> bool:
    """PATCH-обновление задачи. Поддерживает: title, description, assignee_id,
    deadline, priority, status, source.

    Автоматически:
    - При смене status на 'done' заполняет done_at.
    - При снятии 'done' — done_at сбрасывается.
    """
    current = await _fetch_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
    if not current:
        return False

    allowed = (
        "title", "description", "assignee_id",
        "deadline", "priority", "status", "source",
        "contract_id",                                  # ЭТАП 16В-2
    )
    update_fields = []
    values: list[Any] = []
    for col in allowed:
        if col in fields:
            val = fields[col]
            if isinstance(val, str) and val == "":
                val = None
            update_fields.append(f"{col} = ?")
            values.append(val)

    # Логика done_at
    if "status" in fields:
        new_status = fields["status"]
        if new_status == "done" and current.get("status") != "done":
            update_fields.append("done_at = datetime('now')")
        elif new_status != "done" and current.get("status") == "done":
            update_fields.append("done_at = NULL")

    if not update_fields:
        return True

    update_fields.append("updated_at = datetime('now')")
    values.append(task_id)

    sql = f"UPDATE tasks SET {', '.join(update_fields)} WHERE id = ?"
    await _execute(sql, tuple(values))
    return True


async def get_task_by_id(task_id: int) -> dict | None:
    """Возвращает задачу с JOIN на исполнителя (employees) и договор (contracts + contractors).

    ЭТАП 16В-2: добавлены поля contract_number и contractor_name
    для отображения бейджа договора в карточке задачи.
    """
    return await _fetch_one(
        """SELECT t.*,
                  emp.short_name AS assignee_short,
                  emp.full_name AS assignee_full,
                  c.number AS contract_number,
                  c.is_active AS contract_is_active,
                  ctr.name AS contractor_name
           FROM tasks t
           LEFT JOIN employees emp ON emp.id = t.assignee_id
           LEFT JOIN contracts c   ON c.id   = t.contract_id
           LEFT JOIN contractors ctr ON ctr.id = c.contractor_id
           WHERE t.id = ?""",
        (task_id,),
    )


async def get_tasks(
    status: str | None = None,            # 'new' / 'in_progress' / 'done' / 'cancelled' / 'open' (= new + in_progress)
    assignee_id: int | None = None,       # отфильтровать по исполнителю
    creator_chat_id: int | None = None,   # отфильтровать по создателю (для «мои поставленные»)
    contract_id: int | None = None,       # ЭТАП 16В-2: отфильтровать по договору
    only_active: bool = True,
    limit: int = 500,
) -> list[dict]:
    """Список задач с JOIN на исполнителя и договор.

    Сортировка:
    - Сначала открытые (new + in_progress), потом done/cancelled
    - Внутри открытых — сначала срочные, потом по дедлайну (ближайшие сверху),
      потом по дате создания.

    ЭТАП 16В-2: добавлены поля contract_number и contractor_name
    для бейджей "№ X · Контрагент" в строках списка.
    """
    where = []
    params: list[Any] = []

    if only_active:
        where.append("t.is_active = 1")

    if status == "open":
        where.append("t.status IN ('new', 'in_progress')")
    elif status:
        where.append("t.status = ?")
        params.append(status)

    if assignee_id is not None:
        where.append("t.assignee_id = ?")
        params.append(assignee_id)

    if creator_chat_id is not None:
        where.append("t.creator_chat_id = ?")
        params.append(creator_chat_id)

    if contract_id is not None:                          # ЭТАП 16В-2
        where.append("t.contract_id = ?")
        params.append(contract_id)

    sql = """SELECT t.*,
                    emp.short_name AS assignee_short,
                    emp.full_name AS assignee_full,
                    c.number AS contract_number,
                    c.is_active AS contract_is_active,
                    ctr.name AS contractor_name
             FROM tasks t
             LEFT JOIN employees emp ON emp.id = t.assignee_id
             LEFT JOIN contracts c   ON c.id   = t.contract_id
             LEFT JOIN contractors ctr ON ctr.id = c.contractor_id"""
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += """
             ORDER BY
                CASE WHEN t.status IN ('new', 'in_progress') THEN 0 ELSE 1 END,
                CASE t.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                CASE WHEN t.deadline IS NULL THEN 1 ELSE 0 END,
                t.deadline ASC,
                t.created_at DESC"""
    sql += f" LIMIT {int(limit)}"
    return await _fetch_all(sql, tuple(params))


async def get_tasks_count_by_contract(contract_id: int) -> dict:
    """ЭТАП 16В-2: счётчик задач договора (открытые / закрытые / всего).
    Используется для бейджа на карточке договора."""
    rows = await _fetch_all(
        """SELECT status, COUNT(*) AS cnt FROM tasks
           WHERE is_active = 1 AND contract_id = ?
           GROUP BY status""",
        (contract_id,),
    )
    out = {"new": 0, "in_progress": 0, "done": 0, "cancelled": 0, "open": 0, "total": 0}
    for r in rows:
        out[r["status"]] = r["cnt"]
        out["total"] += r["cnt"]
    out["open"] = out["new"] + out["in_progress"]
    return out


async def detach_tasks_from_contract(contract_id: int) -> int:
    """ЭТАП 16В-2: отвязывает все задачи от договора (contract_id → NULL).

    Используется при hard-delete договора (если он будет).
    При архивации (is_active=0) задачи НЕ открепляются — связь сохраняется
    для истории. Возвращает количество отвязанных задач.
    """
    async with aiosqlite.connect(DB_PATH) as conn:
        cur = await conn.execute(
            """UPDATE tasks
               SET contract_id = NULL, updated_at = datetime('now')
               WHERE contract_id = ?""",
            (contract_id,),
        )
        await conn.commit()
        return cur.rowcount or 0


async def get_tasks_count_by_status() -> dict:
    """Счётчики для шапки списка задач: открытые / готовые / отменённые."""
    rows = await _fetch_all(
        """SELECT status, COUNT(*) AS cnt FROM tasks
           WHERE is_active = 1
           GROUP BY status"""
    )
    counts = {"new": 0, "in_progress": 0, "done": 0, "cancelled": 0}
    for r in rows:
        counts[r["status"]] = r["cnt"]
    counts["open"] = counts["new"] + counts["in_progress"]
    return counts


async def set_task_active(task_id: int, is_active: bool) -> bool:
    """Soft-delete задачи."""
    return await _execute_returning_changes(
        "UPDATE tasks SET is_active = ?, updated_at = datetime('now') WHERE id = ?",
        (1 if is_active else 0, task_id),
    ) > 0


async def _execute_returning_changes(sql: str, params: tuple = ()) -> int:
    """Возвращает количество изменённых строк."""
    async with aiosqlite.connect(DB_PATH) as conn:
        cur = await conn.execute(sql, params)
        changes = conn.total_changes
        await conn.commit()
        return changes


# ---- Уведомления ----

async def get_tasks_needing_notif_assigned() -> list[dict]:
    """Задачи, по которым ещё не отправлено уведомление о назначении.

    Берём только активные с assignee_id и без сброшенного флага.
    """
    return await _fetch_all(
        """SELECT t.*,
                  emp.short_name AS assignee_short,
                  emp.full_name AS assignee_full,
                  emp.telegram_id AS assignee_tg
           FROM tasks t
           LEFT JOIN employees emp ON emp.id = t.assignee_id
           WHERE t.is_active = 1
             AND t.notif_assigned_sent = 0
             AND t.assignee_id IS NOT NULL
             AND emp.telegram_id IS NOT NULL
             AND t.status IN ('new', 'in_progress')"""
    )


async def get_tasks_needing_notif_deadline() -> list[dict]:
    """Задачи, по которым нужно напоминание о дедлайне (1 день до).

    Условия:
    - Активная, открытая (new/in_progress)
    - Дедлайн = завтра
    - Уведомление о дедлайне ещё не отправлено
    - Есть исполнитель с telegram_id
    """
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    return await _fetch_all(
        """SELECT t.*,
                  emp.short_name AS assignee_short,
                  emp.full_name AS assignee_full,
                  emp.telegram_id AS assignee_tg
           FROM tasks t
           LEFT JOIN employees emp ON emp.id = t.assignee_id
           WHERE t.is_active = 1
             AND t.notif_deadline_sent = 0
             AND t.deadline = ?
             AND t.assignee_id IS NOT NULL
             AND emp.telegram_id IS NOT NULL
             AND t.status IN ('new', 'in_progress')""",
        (tomorrow,),
    )


async def mark_task_notif_sent(task_id: int, kind: str) -> None:
    """kind: 'assigned' | 'deadline'."""
    if kind == "assigned":
        await _execute(
            "UPDATE tasks SET notif_assigned_sent = 1 WHERE id = ?", (task_id,)
        )
    elif kind == "deadline":
        await _execute(
            "UPDATE tasks SET notif_deadline_sent = 1 WHERE id = ?", (task_id,)
        )


# ============================================================================
# ============ ЭТАП 16Г: ГЛАВНАЯ — ОТГРУЗКИ И АКТИВНОСТИ ====================
# ============================================================================

async def get_upcoming_shipments(days_ahead: int = 14, limit: int = 10) -> list[dict]:
    """Договоры со сроком отгрузки в ближайшие N дней или уже просроченные.

    Включает только активные договоры в статусах 'production' и 'ready'.
    Сортировка: сначала просроченные (от самого давнего), потом по возрастанию даты.
    """
    today = date.today().isoformat()
    horizon = (date.today() + timedelta(days=days_ahead)).isoformat()
    return await _fetch_all(
        """SELECT c.*,
                  co.name AS contractor_name,
                  co.phone AS contractor_phone,
                  emp.short_name AS manager_name
           FROM contracts c
           LEFT JOIN contractors co ON co.id = c.contractor_id
           LEFT JOIN employees emp ON emp.id = c.manager_id
           WHERE c.is_active = 1
             AND c.status IN ('production', 'ready')
             AND c.delivery_date IS NOT NULL
             AND c.delivery_date <= ?
           ORDER BY c.delivery_date ASC
           LIMIT ?""",
        (horizon, limit),
    )


# Типы событий которые показываем на ленте активностей. Остальные скрыты.
# Ключ → шаблон сообщения. {payload} = название сущности, {who} = ФИО.
RECENT_ACTIVITY_ACTIONS = {
    "create_assembly":   ("ti-tool",         "собрал(а)"),
    "create_contract":   ("ti-file-text",    "создал(а) договор"),
    "update_contract":   ("ti-edit",         "изменил(а) договор"),
    "create_offer":      ("ti-file-invoice", "создал(а) КП"),
    "update_offer":      ("ti-edit",         "обновил(а) КП"),
    "create_contractor": ("ti-briefcase",    "добавил(а) контрагента"),
    "create_task":       ("ti-checklist",    "поставил(а) задачу"),
    "update_task":       ("ti-edit",         "обновил(а) задачу"),
    "create_employee":   ("ti-user-plus",    "добавил(а) сотрудника"),
}


async def get_recent_activity(limit: int = 15) -> list[dict]:
    """Последние события из audit_log с присоединением имени автора.

    Возвращает только события из RECENT_ACTIVITY_ACTIONS.
    """
    actions_str = ",".join(f"'{a}'" for a in RECENT_ACTIVITY_ACTIONS.keys())
    sql = f"""
        SELECT a.*,
               emp.short_name AS who_short,
               emp.full_name AS who_full
        FROM audit_log a
        LEFT JOIN employees emp ON emp.telegram_id = a.chat_id
        WHERE a.action IN ({actions_str})
        ORDER BY a.id DESC
        LIMIT ?
    """
    return await _fetch_all(sql, (limit,))


# ============================================================================
# ============ ЭТАП 17: КАТЕГОРИИ ПРОДАЖНОЙ НОМЕНКЛАТУРЫ =====================
# ============================================================================

async def get_sale_categories(only_active: bool = True) -> list[dict]:
    """Список категорий продажной номенклатуры со счётчиком товаров."""
    sql = """SELECT c.*,
                    (SELECT COUNT(*) FROM sale_products p
                     WHERE p.category_id = c.id AND p.is_active = 1) AS products_count
             FROM sale_categories c"""
    if only_active:
        sql += " WHERE c.is_active = 1"
    sql += " ORDER BY c.sort_order, c.name COLLATE NOCASE"
    return await _fetch_all(sql)


async def get_sale_category_by_id(category_id: int) -> dict | None:
    return await _fetch_one(
        "SELECT * FROM sale_categories WHERE id = ?", (category_id,)
    )


async def create_sale_category(name: str, sort_order: int = 0) -> int:
    return await _execute(
        "INSERT INTO sale_categories (name, sort_order) VALUES (?, ?)",
        (name.strip(), sort_order),
    )


async def update_sale_category(
    category_id: int,
    name: str | None = None,
    sort_order: int | None = None,
) -> bool:
    current = await get_sale_category_by_id(category_id)
    if not current:
        return False
    fields = []
    values: list[Any] = []
    if name is not None and name.strip():
        fields.append("name = ?")
        values.append(name.strip())
    if sort_order is not None:
        fields.append("sort_order = ?")
        values.append(sort_order)
    if not fields:
        return True
    fields.append("updated_at = datetime('now')")
    values.append(category_id)
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            f"UPDATE sale_categories SET {', '.join(fields)} WHERE id = ?",
            tuple(values),
        )
        await conn.commit()
    return True


async def set_sale_category_active(category_id: int, is_active: bool) -> bool:
    """Soft-delete категории. Связанные товары остаются (category_id у них сохраняется)."""
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            "UPDATE sale_categories SET is_active = ?, updated_at = datetime('now') WHERE id = ?",
            (1 if is_active else 0, category_id),
        )
        await conn.commit()
    return True


# ============ ЭТАП 18: СКЛАД (warehouse_movements) ============
#
# Архитектура:
# - Один центральный склад, только сборки (assemblies).
# - Остатки вычисляются на лету из journal: SUM('in') - SUM('out') - SUM('write_off').
# - Никакой отдельной таблицы текущих остатков нет — это исключает рассинхронизацию.
# - Резерв жёсткий: сборка с contract_id=N отгружается только по договору N.
# - Жизненный цикл сборки через assemblies.status:
#     in_progress → ready → shipped
#                      ↘ written_off


# Допустимые статусы и направления — для валидации в api.py
ASSEMBLY_STATUSES = ("in_progress", "ready", "shipped", "written_off")
ASSEMBLY_STATUS_LABELS = {
    "in_progress": "в работе",
    "ready":       "готова",
    "shipped":     "отгружена",
    "written_off": "списана",
}

WAREHOUSE_DIRECTIONS = ("in", "out", "write_off")
WAREHOUSE_DIRECTION_LABELS = {
    "in":        "приход",
    "out":       "расход",
    "write_off": "списание",
}


async def create_warehouse_movement(
    assembly_id: int,
    direction: str,
    qty: int = 1,
    contract_id: int | None = None,
    reason: str | None = None,
    comment: str | None = None,
    created_by_chat_id: int | None = None,
) -> int:
    """Создаёт запись в журнале движений склада.

    Не меняет статус сборки! Это делает вызывающий код (или хук в update_assembly).
    Возвращает id новой записи.
    """
    if direction not in WAREHOUSE_DIRECTIONS:
        raise ValueError(f"Недопустимое направление: {direction}")
    return await _execute(
        """INSERT INTO warehouse_movements
           (assembly_id, direction, qty, contract_id, reason, comment, created_by_chat_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (assembly_id, direction, qty, contract_id, reason, comment, created_by_chat_id),
    )


async def get_assembly_stock_qty(assembly_id: int) -> int:
    """Возвращает текущий остаток конкретной сборки на складе.

    Формула: SUM('in') - SUM('out') - SUM('write_off').
    Для готовой сборки (qty=1) это будет 1 (если ещё не отгружена) или 0 (если отгружена/списана).
    """
    row = await _fetch_one(
        """SELECT
             COALESCE(SUM(CASE WHEN direction = 'in' THEN qty ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN direction = 'out' THEN qty ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN direction = 'write_off' THEN qty ELSE 0 END), 0)
           AS qty
           FROM warehouse_movements
           WHERE assembly_id = ?""",
        (assembly_id,),
    )
    return int(row["qty"]) if row and row["qty"] is not None else 0


async def get_warehouse_stock(
    search: str | None = None,         # поиск по модели/материалу
    contract_id: int | None = None,    # 'free' будет передаваться отдельным параметром
    only_free: bool = False,           # True = только свободные (contract_id IS NULL)
    only_reserved: bool = False,       # True = только зарезервированные (contract_id IS NOT NULL)
    limit: int = 500,
) -> list[dict]:
    """Возвращает список сборок, лежащих на складе (status='ready' и остаток > 0).

    Каждая строка содержит данные сборки + JOIN на model/contract/contractor для UI.
    """
    where = ["a.is_active = 1", "a.status = 'ready'"]
    params: list[Any] = []

    if contract_id is not None:
        where.append("a.contract_id = ?")
        params.append(contract_id)
    elif only_free:
        where.append("a.contract_id IS NULL")
    elif only_reserved:
        where.append("a.contract_id IS NOT NULL")

    if search:
        where.append("(LOWER(m.name) LIKE ? OR LOWER(a.execution) LIKE ? OR LOWER(a.ip_class) LIKE ?)")
        like = f"%{search.lower()}%"
        params.extend([like, like, like])

    # Фильтр "остаток > 0" — подзапросом в WHERE (HAVING без GROUP BY в SQLite ведёт себя
    # иначе чем ожидаешь, поэтому используем WHERE с тем же подзапросом)
    where.append(
        """(SELECT COALESCE(SUM(CASE WHEN direction='in' THEN qty ELSE 0 END), 0)
                 - COALESCE(SUM(CASE WHEN direction='out' THEN qty ELSE 0 END), 0)
                 - COALESCE(SUM(CASE WHEN direction='write_off' THEN qty ELSE 0 END), 0)
            FROM warehouse_movements w WHERE w.assembly_id = a.id) > 0"""
    )

    sql = """
        SELECT a.id, a.model_id, a.execution, a.ip_class, a.quantity,
               a.assembly_date, a.comment, a.contract_id, a.status,
               a.created_at, a.updated_at,
               m.name AS model_name, m.article AS model_article,
               c.number AS contract_number,
               c.is_active AS contract_is_active,
               ctr.name AS contractor_name,
               -- остаток дублируем в SELECT, чтобы вернуть его в ответе
               (SELECT COALESCE(SUM(CASE WHEN direction='in' THEN qty ELSE 0 END), 0)
                       - COALESCE(SUM(CASE WHEN direction='out' THEN qty ELSE 0 END), 0)
                       - COALESCE(SUM(CASE WHEN direction='write_off' THEN qty ELSE 0 END), 0)
                FROM warehouse_movements w WHERE w.assembly_id = a.id) AS stock_qty
        FROM assemblies a
        LEFT JOIN models m       ON m.id   = a.model_id
        LEFT JOIN contracts c    ON c.id   = a.contract_id
        LEFT JOIN contractors ctr ON ctr.id = c.contractor_id
        WHERE """ + " AND ".join(where) + """
        ORDER BY
            CASE WHEN a.contract_id IS NULL THEN 0 ELSE 1 END,
            a.assembly_date DESC,
            a.id DESC
        LIMIT """ + str(int(limit))
    return await _fetch_all(sql, tuple(params))


async def get_warehouse_stock_summary() -> dict:
    """Сводка по складу: сколько всего на складе, сколько свободных, сколько зарезервированных.

    Используется для бейджей в шапке раздела «Склад».
    """
    row = await _fetch_one(
        """
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN a.contract_id IS NULL THEN 1 ELSE 0 END) AS free_count,
            SUM(CASE WHEN a.contract_id IS NOT NULL THEN 1 ELSE 0 END) AS reserved_count
        FROM assemblies a
        WHERE a.is_active = 1 AND a.status = 'ready'
          AND (SELECT COALESCE(SUM(CASE WHEN direction='in' THEN qty ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN direction='out' THEN qty ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN direction='write_off' THEN qty ELSE 0 END), 0)
               FROM warehouse_movements w WHERE w.assembly_id = a.id) > 0
        """
    )
    if not row:
        return {"total": 0, "free": 0, "reserved": 0}
    return {
        "total":    int(row["total"] or 0),
        "free":     int(row["free_count"] or 0),
        "reserved": int(row["reserved_count"] or 0),
    }


async def get_warehouse_movements(
    assembly_id: int | None = None,
    contract_id: int | None = None,
    direction: str | None = None,
    date_from: str | None = None,      # YYYY-MM-DD
    date_to: str | None = None,
    limit: int = 200,
) -> list[dict]:
    """Журнал движений склада с JOIN на assembly/model/contract/contractor."""
    where = []
    params: list[Any] = []

    if assembly_id is not None:
        where.append("w.assembly_id = ?")
        params.append(assembly_id)
    if contract_id is not None:
        where.append("w.contract_id = ?")
        params.append(contract_id)
    if direction:
        where.append("w.direction = ?")
        params.append(direction)
    if date_from:
        where.append("DATE(w.created_at) >= ?")
        params.append(date_from)
    if date_to:
        where.append("DATE(w.created_at) <= ?")
        params.append(date_to)

    sql = """
        SELECT w.id, w.assembly_id, w.direction, w.qty,
               w.contract_id, w.reason, w.comment,
               w.created_at, w.created_by_chat_id,
               a.execution AS a_execution, a.ip_class AS a_ip_class,
               m.name AS model_name, m.article AS model_article,
               c.number AS contract_number,
               ctr.name AS contractor_name
        FROM warehouse_movements w
        LEFT JOIN assemblies a   ON a.id   = w.assembly_id
        LEFT JOIN models m       ON m.id   = a.model_id
        LEFT JOIN contracts c    ON c.id   = w.contract_id
        LEFT JOIN contractors ctr ON ctr.id = c.contractor_id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY w.created_at DESC, w.id DESC"
    sql += f" LIMIT {int(limit)}"
    return await _fetch_all(sql, tuple(params))


async def get_assembly_movements(assembly_id: int) -> list[dict]:
    """Краткая история движений конкретной сборки (для её карточки)."""
    return await get_warehouse_movements(assembly_id=assembly_id, limit=50)


async def ship_assemblies_by_contract(
    contract_id: int,
    chat_id: int | None = None,
) -> dict:
    """Гибрид-операция: отгрузить ВСЕ готовые сборки, привязанные к договору.

    Алгоритм:
    1. Берём все сборки с contract_id=N, status='ready', is_active=1.
    2. Для каждой: проверяем что остаток > 0 (защита от двойной отгрузки).
    3. Создаём movement(direction='out', contract_id=N, qty=quantity).
    4. Меняем статус сборки на 'shipped'.

    Возвращает: {"shipped": N, "skipped": M, "details": [...]}.
    Если на складе по этому договору ничего нет — вернёт shipped=0.
    """
    rows = await _fetch_all(
        """SELECT a.id, a.quantity, m.name AS model_name
           FROM assemblies a
           LEFT JOIN models m ON m.id = a.model_id
           WHERE a.is_active = 1
             AND a.status = 'ready'
             AND a.contract_id = ?""",
        (contract_id,),
    )
    shipped = 0
    skipped = 0
    details: list[dict] = []
    for r in rows:
        aid = r["id"]
        qty = r["quantity"] or 1
        stock = await get_assembly_stock_qty(aid)
        if stock < qty:
            skipped += 1
            details.append({
                "assembly_id": aid,
                "model_name":  r.get("model_name") or "—",
                "result":      "skipped_no_stock",
            })
            continue
        # Списываем
        await create_warehouse_movement(
            assembly_id=aid,
            direction="out",
            qty=qty,
            contract_id=contract_id,
            reason="Отгрузка по договору",
            created_by_chat_id=chat_id,
        )
        async with aiosqlite.connect(DB_PATH) as conn:
            await conn.execute(
                """UPDATE assemblies
                   SET status = 'shipped',
                       updated_at = datetime('now'),
                       updated_by_chat_id = ?
                   WHERE id = ?""",
                (chat_id, aid),
            )
            await conn.commit()
        shipped += 1
        details.append({
            "assembly_id": aid,
            "model_name":  r.get("model_name") or "—",
            "result":      "shipped",
        })
    return {"shipped": shipped, "skipped": skipped, "details": details}


# ============================================================
# ============ ЭТАП 19: СНАБЖЕНИЕ ============
# ============================================================

# Допустимые значения — для валидации в api.py
SUPPLY_ITEM_KINDS = ("material", "product")
SUPPLY_ITEM_KIND_LABELS = {
    "material": "Комплектующее",
    "product":  "Товар для перепродажи",
}

SUPPLY_REQUEST_STATUSES = ("new", "ordered", "received", "cancelled")
SUPPLY_REQUEST_STATUS_LABELS = {
    "new":       "новая",
    "ordered":   "в заказе",
    "received":  "получена",
    "cancelled": "отменена",
}

SUPPLY_ORDER_STATUSES = ("draft", "sent", "received", "partial", "cancelled")
SUPPLY_ORDER_STATUS_LABELS = {
    "draft":     "черновик",
    "sent":      "отправлен",
    "partial":   "частично",
    "received":  "получен",
    "cancelled": "отменён",
}


# ============ Поставщики ============

async def create_supplier(
    name: str,
    inn: str | None = None,
    contact_person: str | None = None,
    phone: str | None = None,
    email: str | None = None,
    comment: str | None = None,
    created_by_chat_id: int | None = None,
) -> int:
    return await _execute(
        """INSERT INTO suppliers
           (name, inn, contact_person, phone, email, comment, created_by_chat_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (name.strip(), inn, contact_person, phone, email, comment, created_by_chat_id),
    )


async def get_supplier_by_id(supplier_id: int) -> dict | None:
    return await _fetch_one("SELECT * FROM suppliers WHERE id = ?", (supplier_id,))


async def get_suppliers(only_active: bool = True, search: str | None = None) -> list[dict]:
    where = []
    params: list[Any] = []
    if only_active:
        where.append("is_active = 1")
    if search:
        where.append("(LOWER(name) LIKE ? OR LOWER(inn) LIKE ?)")
        like = f"%{search.lower()}%"
        params.extend([like, like])
    sql = "SELECT * FROM suppliers"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY name COLLATE NOCASE"
    return await _fetch_all(sql, tuple(params))


async def update_supplier(supplier_id: int, **fields: Any) -> bool:
    allowed = ("name", "inn", "contact_person", "phone", "email", "comment")
    sets, values = [], []
    for k, v in fields.items():
        if k not in allowed:
            continue
        sets.append(f"{k} = ?")
        values.append(v.strip() if isinstance(v, str) else v)
    if not sets:
        return True
    sets.append("updated_at = datetime('now')")
    if "updated_by_chat_id" in fields:
        sets.append("updated_by_chat_id = ?")
        values.append(fields["updated_by_chat_id"])
    values.append(supplier_id)
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            f"UPDATE suppliers SET {', '.join(sets)} WHERE id = ?", tuple(values),
        )
        await conn.commit()
    return True


async def set_supplier_active(supplier_id: int, is_active: bool) -> bool:
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            "UPDATE suppliers SET is_active = ?, updated_at = datetime('now') WHERE id = ?",
            (1 if is_active else 0, supplier_id),
        )
        await conn.commit()
    return True


# ============ Каталог закупаемой номенклатуры ============

async def create_supply_item(
    name: str,
    kind: str = "material",
    unit: str = "шт.",
    comment: str | None = None,
    created_by_chat_id: int | None = None,
) -> int:
    if kind not in SUPPLY_ITEM_KINDS:
        kind = "material"
    return await _execute(
        """INSERT INTO supply_items (name, kind, unit, comment, created_by_chat_id)
           VALUES (?, ?, ?, ?, ?)""",
        (name.strip(), kind, (unit or "шт.").strip(), comment, created_by_chat_id),
    )


async def get_supply_item_by_id(item_id: int) -> dict | None:
    return await _fetch_one("SELECT * FROM supply_items WHERE id = ?", (item_id,))


async def get_supply_items(
    only_active: bool = True,
    kind: str | None = None,
    search: str | None = None,
) -> list[dict]:
    where = []
    params: list[Any] = []
    if only_active:
        where.append("is_active = 1")
    if kind in SUPPLY_ITEM_KINDS:
        where.append("kind = ?")
        params.append(kind)
    if search:
        where.append("LOWER(name) LIKE ?")
        params.append(f"%{search.lower()}%")
    sql = "SELECT * FROM supply_items"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY name COLLATE NOCASE"
    return await _fetch_all(sql, tuple(params))


async def update_supply_item(item_id: int, **fields: Any) -> bool:
    allowed = ("name", "kind", "unit", "comment")
    sets, values = [], []
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k == "kind" and v not in SUPPLY_ITEM_KINDS:
            continue
        sets.append(f"{k} = ?")
        values.append(v.strip() if isinstance(v, str) else v)
    if not sets:
        return True
    sets.append("updated_at = datetime('now')")
    values.append(item_id)
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            f"UPDATE supply_items SET {', '.join(sets)} WHERE id = ?", tuple(values),
        )
        await conn.commit()
    return True


async def set_supply_item_active(item_id: int, is_active: bool) -> bool:
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            "UPDATE supply_items SET is_active = ?, updated_at = datetime('now') WHERE id = ?",
            (1 if is_active else 0, item_id),
        )
        await conn.commit()
    return True


# ============ Заявки на закупку ============

async def create_supply_request(
    item_id: int,
    qty: float,
    needed_by: str | None = None,
    contract_id: int | None = None,
    comment: str | None = None,
    created_by_chat_id: int | None = None,
) -> int:
    return await _execute(
        """INSERT INTO supply_requests
           (item_id, qty, needed_by, contract_id, comment, created_by_chat_id)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (item_id, qty, needed_by, contract_id, comment, created_by_chat_id),
    )


async def get_supply_request_by_id(request_id: int) -> dict | None:
    return await _fetch_one(
        """SELECT r.*,
                  i.name AS item_name, i.kind AS item_kind, i.unit AS item_unit,
                  c.number AS contract_number,
                  ctr.name AS contractor_name
           FROM supply_requests r
           LEFT JOIN supply_items i  ON i.id   = r.item_id
           LEFT JOIN contracts c     ON c.id   = r.contract_id
           LEFT JOIN contractors ctr ON ctr.id = c.contractor_id
           WHERE r.id = ?""",
        (request_id,),
    )


async def get_supply_requests(
    status: str | None = None,
    contract_id: int | None = None,
    only_active: bool = True,
    limit: int = 500,
) -> list[dict]:
    where = []
    params: list[Any] = []
    if only_active:
        where.append("r.is_active = 1")
    if status in SUPPLY_REQUEST_STATUSES:
        where.append("r.status = ?")
        params.append(status)
    elif status == "open":
        where.append("r.status IN ('new', 'ordered')")
    if contract_id is not None:
        where.append("r.contract_id = ?")
        params.append(contract_id)

    sql = """SELECT r.*,
                    i.name AS item_name, i.kind AS item_kind, i.unit AS item_unit,
                    c.number AS contract_number,
                    ctr.name AS contractor_name
             FROM supply_requests r
             LEFT JOIN supply_items i  ON i.id   = r.item_id
             LEFT JOIN contracts c     ON c.id   = r.contract_id
             LEFT JOIN contractors ctr ON ctr.id = c.contractor_id"""
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += """ ORDER BY
                CASE WHEN r.status IN ('new', 'ordered') THEN 0 ELSE 1 END,
                CASE WHEN r.needed_by IS NULL THEN 1 ELSE 0 END,
                r.needed_by ASC,
                r.created_at DESC"""
    sql += f" LIMIT {int(limit)}"
    return await _fetch_all(sql, tuple(params))


async def update_supply_request(request_id: int, **fields: Any) -> bool:
    allowed = ("item_id", "qty", "needed_by", "contract_id", "status", "comment")
    sets, values = [], []
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k == "status" and v not in SUPPLY_REQUEST_STATUSES:
            continue
        sets.append(f"{k} = ?")
        values.append(v.strip() if isinstance(v, str) else v)
    if not sets:
        return True
    sets.append("updated_at = datetime('now')")
    values.append(request_id)
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            f"UPDATE supply_requests SET {', '.join(sets)} WHERE id = ?", tuple(values),
        )
        await conn.commit()
    return True


async def set_supply_request_active(request_id: int, is_active: bool) -> bool:
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            "UPDATE supply_requests SET is_active = ?, updated_at = datetime('now') WHERE id = ?",
            (1 if is_active else 0, request_id),
        )
        await conn.commit()
    return True


# ============ Заказы поставщикам ============

async def create_supply_order(
    supplier_id: int,
    expected_date: str | None = None,
    comment: str | None = None,
    created_by_chat_id: int | None = None,
) -> int:
    """Создаёт черновик заказа."""
    return await _execute(
        """INSERT INTO supply_orders
           (supplier_id, status, expected_date, comment, created_by_chat_id)
           VALUES (?, 'draft', ?, ?, ?)""",
        (supplier_id, expected_date, comment, created_by_chat_id),
    )


async def get_supply_order_by_id(order_id: int) -> dict | None:
    """Возвращает заказ + поставщик + позиции (с inline-инфой по item и заявке)."""
    order = await _fetch_one(
        """SELECT o.*,
                  s.name AS supplier_name, s.contact_person AS supplier_contact,
                  s.phone AS supplier_phone, s.email AS supplier_email
           FROM supply_orders o
           LEFT JOIN suppliers s ON s.id = o.supplier_id
           WHERE o.id = ?""",
        (order_id,),
    )
    if not order:
        return None
    items = await _fetch_all(
        """SELECT oi.*,
                  i.name AS item_name, i.kind AS item_kind, i.unit AS item_unit,
                  r.needed_by AS request_needed_by,
                  r.contract_id AS request_contract_id,
                  c.number AS contract_number
           FROM supply_order_items oi
           LEFT JOIN supply_items i      ON i.id = oi.item_id
           LEFT JOIN supply_requests r   ON r.id = oi.request_id
           LEFT JOIN contracts c         ON c.id = r.contract_id
           WHERE oi.order_id = ?
           ORDER BY oi.id""",
        (order_id,),
    )
    order["items"] = items
    return order


async def get_supply_orders(
    status: str | None = None,
    supplier_id: int | None = None,
    only_active: bool = True,
    limit: int = 200,
) -> list[dict]:
    """Список заказов с inline-сводкой (без вложенного списка позиций)."""
    where = []
    params: list[Any] = []
    if only_active:
        where.append("o.is_active = 1")
    if status in SUPPLY_ORDER_STATUSES:
        where.append("o.status = ?")
        params.append(status)
    elif status == "open":
        where.append("o.status IN ('draft', 'sent', 'partial')")
    if supplier_id is not None:
        where.append("o.supplier_id = ?")
        params.append(supplier_id)

    sql = """SELECT o.*,
                    s.name AS supplier_name,
                    (SELECT COUNT(*) FROM supply_order_items oi WHERE oi.order_id = o.id) AS items_count,
                    (SELECT COALESCE(SUM(oi.qty * COALESCE(oi.price, 0)), 0)
                     FROM supply_order_items oi WHERE oi.order_id = o.id) AS total_amount
             FROM supply_orders o
             LEFT JOIN suppliers s ON s.id = o.supplier_id"""
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += """ ORDER BY
                CASE WHEN o.status IN ('draft', 'sent', 'partial') THEN 0 ELSE 1 END,
                o.created_at DESC"""
    sql += f" LIMIT {int(limit)}"
    return await _fetch_all(sql, tuple(params))


async def add_supply_order_item(
    order_id: int,
    item_id: int,
    qty: float,
    price: float | None = None,
    request_id: int | None = None,
    comment: str | None = None,
) -> int:
    """Добавляет позицию в заказ. Если request_id указан — переводит заявку в 'ordered'."""
    async with aiosqlite.connect(DB_PATH) as conn:
        cur = await conn.execute(
            """INSERT INTO supply_order_items
               (order_id, item_id, qty, price, request_id, comment)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (order_id, item_id, qty, price, request_id, comment),
        )
        item_row_id = cur.lastrowid
        if request_id is not None:
            await conn.execute(
                "UPDATE supply_requests SET status = 'ordered', updated_at = datetime('now') WHERE id = ?",
                (request_id,),
            )
        await conn.execute(
            "UPDATE supply_orders SET updated_at = datetime('now') WHERE id = ?",
            (order_id,),
        )
        await conn.commit()
        return item_row_id


async def remove_supply_order_item(order_item_id: int) -> bool:
    """Удаляет позицию из заказа. Если она была связана с заявкой — возвращает заявку в 'new'."""
    row = await _fetch_one(
        "SELECT order_id, request_id FROM supply_order_items WHERE id = ?",
        (order_item_id,),
    )
    if not row:
        return False
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute("DELETE FROM supply_order_items WHERE id = ?", (order_item_id,))
        if row.get("request_id"):
            await conn.execute(
                "UPDATE supply_requests SET status = 'new', updated_at = datetime('now') WHERE id = ?",
                (row["request_id"],),
            )
        await conn.execute(
            "UPDATE supply_orders SET updated_at = datetime('now') WHERE id = ?",
            (row["order_id"],),
        )
        await conn.commit()
    return True


async def update_supply_order(order_id: int, **fields: Any) -> bool:
    allowed = ("supplier_id", "status", "expected_date", "comment")
    sets, values = [], []
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k == "status" and v not in SUPPLY_ORDER_STATUSES:
            continue
        sets.append(f"{k} = ?")
        values.append(v.strip() if isinstance(v, str) else v)
    if not sets:
        return True
    sets.append("updated_at = datetime('now')")
    values.append(order_id)
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            f"UPDATE supply_orders SET {', '.join(sets)} WHERE id = ?", tuple(values),
        )
        await conn.commit()
    return True


async def send_supply_order(order_id: int) -> bool:
    """Перевод заказа draft → sent + фиксация даты отправки."""
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            """UPDATE supply_orders
               SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now')
               WHERE id = ? AND status = 'draft'""",
            (order_id,),
        )
        await conn.commit()
    return True


async def set_supply_order_active(order_id: int, is_active: bool) -> bool:
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            "UPDATE supply_orders SET is_active = ?, updated_at = datetime('now') WHERE id = ?",
            (1 if is_active else 0, order_id),
        )
        await conn.commit()
    return True


# ============ Приёмки ============

async def create_supply_receipt(
    order_id: int,
    received_date: str,
    items: list[dict],          # [{"order_item_id": N, "qty": M, "comment": ""}]
    comment: str | None = None,
    received_by_chat_id: int | None = None,
) -> int:
    """Создаёт приёмку и обновляет received_qty в позициях заказа.

    После создания пересчитывает статус заказа (received / partial)
    и при полной приёмке переводит связанные заявки в 'received'.
    """
    async with aiosqlite.connect(DB_PATH) as conn:
        cur = await conn.execute(
            """INSERT INTO supply_receipts
               (order_id, received_date, comment, received_by_chat_id)
               VALUES (?, ?, ?, ?)""",
            (order_id, received_date, comment, received_by_chat_id),
        )
        receipt_id = cur.lastrowid

        for it in items:
            oi_id = it.get("order_item_id")
            qty = float(it.get("qty") or 0)
            if not oi_id or qty <= 0:
                continue
            await conn.execute(
                """INSERT INTO supply_receipt_items
                   (receipt_id, order_item_id, qty, comment)
                   VALUES (?, ?, ?, ?)""",
                (receipt_id, oi_id, qty, it.get("comment")),
            )
            await conn.execute(
                "UPDATE supply_order_items SET received_qty = COALESCE(received_qty, 0) + ? WHERE id = ?",
                (qty, oi_id),
            )

        # Пересчёт статуса заказа
        # Берём все позиции заказа
        cur2 = await conn.execute(
            """SELECT id, qty, COALESCE(received_qty, 0) AS received, request_id
               FROM supply_order_items WHERE order_id = ?""",
            (order_id,),
        )
        order_items = await cur2.fetchall()
        total_qty = sum(float(r["qty"] or 0) for r in order_items)
        recv_qty = sum(float(r["received"] or 0) for r in order_items)

        if total_qty > 0 and recv_qty >= total_qty:
            new_status = "received"
        elif recv_qty > 0:
            new_status = "partial"
        else:
            new_status = None  # без изменений

        if new_status:
            await conn.execute(
                "UPDATE supply_orders SET status = ?, updated_at = datetime('now') WHERE id = ?",
                (new_status, order_id),
            )

        # Если заказ полностью принят — связанные заявки → 'received'
        if new_status == "received":
            for r in order_items:
                if r["request_id"]:
                    await conn.execute(
                        "UPDATE supply_requests SET status = 'received', updated_at = datetime('now') WHERE id = ?",
                        (r["request_id"],),
                    )

        await conn.commit()
        return receipt_id


async def get_supply_receipts(
    order_id: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 200,
) -> list[dict]:
    where = []
    params: list[Any] = []
    if order_id is not None:
        where.append("r.order_id = ?")
        params.append(order_id)
    if date_from:
        where.append("DATE(r.received_date) >= ?")
        params.append(date_from)
    if date_to:
        where.append("DATE(r.received_date) <= ?")
        params.append(date_to)

    sql = """SELECT r.*,
                    o.id AS order_id, s.name AS supplier_name,
                    (SELECT COUNT(*) FROM supply_receipt_items ri WHERE ri.receipt_id = r.id) AS items_count
             FROM supply_receipts r
             LEFT JOIN supply_orders o ON o.id = r.order_id
             LEFT JOIN suppliers s     ON s.id = o.supplier_id"""
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY r.received_date DESC, r.id DESC"
    sql += f" LIMIT {int(limit)}"
    return await _fetch_all(sql, tuple(params))


async def get_supply_receipt_by_id(receipt_id: int) -> dict | None:
    receipt = await _fetch_one(
        """SELECT r.*, o.id AS order_id, s.name AS supplier_name
           FROM supply_receipts r
           LEFT JOIN supply_orders o ON o.id = r.order_id
           LEFT JOIN suppliers s     ON s.id = o.supplier_id
           WHERE r.id = ?""",
        (receipt_id,),
    )
    if not receipt:
        return None
    items = await _fetch_all(
        """SELECT ri.*,
                  oi.item_id AS item_id, oi.qty AS ordered_qty, oi.price AS price,
                  i.name AS item_name, i.unit AS item_unit, i.kind AS item_kind
           FROM supply_receipt_items ri
           LEFT JOIN supply_order_items oi ON oi.id = ri.order_item_id
           LEFT JOIN supply_items i        ON i.id  = oi.item_id
           WHERE ri.receipt_id = ?
           ORDER BY ri.id""",
        (receipt_id,),
    )
    receipt["items"] = items
    return receipt


# ============ Сводки для дашбордов ============

async def get_supply_summary() -> dict:
    """Сводка для шапки раздела: открытые заявки, активные заказы и т.п."""
    rows = await _fetch_all("""
        SELECT
            (SELECT COUNT(*) FROM supply_requests WHERE is_active = 1 AND status = 'new')      AS req_new,
            (SELECT COUNT(*) FROM supply_requests WHERE is_active = 1 AND status = 'ordered')  AS req_ordered,
            (SELECT COUNT(*) FROM supply_orders   WHERE is_active = 1 AND status = 'draft')    AS ord_draft,
            (SELECT COUNT(*) FROM supply_orders   WHERE is_active = 1 AND status = 'sent')     AS ord_sent,
            (SELECT COUNT(*) FROM supply_orders   WHERE is_active = 1 AND status = 'partial')  AS ord_partial
    """)
    r = rows[0] if rows else {}
    return {
        "requests_new":      int(r.get("req_new") or 0),
        "requests_ordered":  int(r.get("req_ordered") or 0),
        "orders_draft":      int(r.get("ord_draft") or 0),
        "orders_sent":       int(r.get("ord_sent") or 0),
        "orders_partial":    int(r.get("ord_partial") or 0),
    }


# ============================================================
# ============ ЭТАП 20: КАДРЫ — ОТПУСКА ============
# ============================================================

async def create_vacation(
    employee_id: int,
    start_date: str,
    end_date: str,
    comment: str | None = None,
    created_by_chat_id: int | None = None,
) -> int:
    """Создаёт запись об отпуске."""
    return await _execute(
        """INSERT INTO vacations
           (employee_id, start_date, end_date, comment, created_by_chat_id)
           VALUES (?, ?, ?, ?, ?)""",
        (employee_id, start_date, end_date, comment, created_by_chat_id),
    )


async def get_vacation_by_id(vacation_id: int) -> dict | None:
    return await _fetch_one(
        """SELECT v.*,
                  e.full_name  AS employee_full_name,
                  e.short_name AS employee_short_name,
                  e.position   AS employee_position
           FROM vacations v
           LEFT JOIN employees e ON e.id = v.employee_id
           WHERE v.id = ?""",
        (vacation_id,),
    )


async def get_vacations(
    only_active: bool = True,
    employee_id: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 500,
) -> list[dict]:
    """Список отпусков с фильтрами."""
    where = []
    params: list[Any] = []
    if only_active:
        where.append("v.is_active = 1")
    if employee_id is not None:
        where.append("v.employee_id = ?")
        params.append(employee_id)
    # Пересечение с диапазоном (любой отпуск, который хотя бы частично попадает в окно)
    if date_from:
        where.append("v.end_date >= ?")
        params.append(date_from)
    if date_to:
        where.append("v.start_date <= ?")
        params.append(date_to)
    sql = """SELECT v.*,
                    e.full_name  AS employee_full_name,
                    e.short_name AS employee_short_name,
                    e.position   AS employee_position
             FROM vacations v
             LEFT JOIN employees e ON e.id = v.employee_id"""
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY v.start_date ASC"
    sql += f" LIMIT {int(limit)}"
    return await _fetch_all(sql, tuple(params))


async def update_vacation(vacation_id: int, **fields: Any) -> bool:
    allowed = ("employee_id", "start_date", "end_date", "comment")
    sets, values = [], []
    for k, v in fields.items():
        if k not in allowed:
            continue
        sets.append(f"{k} = ?")
        values.append(v.strip() if isinstance(v, str) else v)
    if not sets:
        return True
    sets.append("updated_at = datetime('now')")
    values.append(vacation_id)
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            f"UPDATE vacations SET {', '.join(sets)} WHERE id = ?", tuple(values),
        )
        await conn.commit()
    return True


async def set_vacation_active(vacation_id: int, is_active: bool) -> bool:
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            "UPDATE vacations SET is_active = ?, updated_at = datetime('now') WHERE id = ?",
            (1 if is_active else 0, vacation_id),
        )
        await conn.commit()
    return True


async def get_current_vacations(today: str | None = None) -> list[dict]:
    """Кто сейчас в отпуске (сегодня попадает в диапазон)."""
    today = today or datetime.now().strftime("%Y-%m-%d")
    return await _fetch_all(
        """SELECT v.*,
                  e.full_name  AS employee_full_name,
                  e.short_name AS employee_short_name,
                  e.position   AS employee_position
           FROM vacations v
           LEFT JOIN employees e ON e.id = v.employee_id
           WHERE v.is_active = 1
             AND v.start_date <= ?
             AND v.end_date >= ?
           ORDER BY v.end_date ASC""",
        (today, today),
    )


async def get_upcoming_vacations(days_ahead: int = 14, today: str | None = None) -> list[dict]:
    """Отпуска, начинающиеся в ближайшие N дней (но ещё не начались)."""
    today_dt = datetime.strptime(today, "%Y-%m-%d") if today else datetime.now()
    today_s = today_dt.strftime("%Y-%m-%d")
    horizon = (today_dt + timedelta(days=days_ahead)).strftime("%Y-%m-%d")
    return await _fetch_all(
        """SELECT v.*,
                  e.full_name  AS employee_full_name,
                  e.short_name AS employee_short_name,
                  e.position   AS employee_position
           FROM vacations v
           LEFT JOIN employees e ON e.id = v.employee_id
           WHERE v.is_active = 1
             AND v.start_date > ?
             AND v.start_date <= ?
           ORDER BY v.start_date ASC""",
        (today_s, horizon),
    )


# ============================================================
# ============ ЭТАП 21: ПУБЛИЧНЫЕ СТРАНИЦЫ (QR) ============
# ============================================================

async def get_assembly_by_public_token(token: str) -> dict | None:
    """Возвращает сборку по public_token. Подгружает связанные модель/договор/сборщиков."""
    if not token:
        return None
    asm = await _fetch_one(
        """SELECT a.*,
                  m.name AS model_name, m.article AS model_article,
                  c.number AS contract_number, c.delivery_date AS contract_delivery_date,
                  ctr.name AS contractor_name
           FROM assemblies a
           LEFT JOIN models m       ON m.id   = a.model_id
           LEFT JOIN contracts c    ON c.id   = a.contract_id
           LEFT JOIN contractors ctr ON ctr.id = c.contractor_id
           WHERE a.public_token = ? AND a.is_active = 1""",
        (token,),
    )
    if not asm:
        return None
    # Сборщики
    workers = await _fetch_all(
        """SELECT e.id, e.full_name, e.short_name
           FROM assembly_workers w
           LEFT JOIN employees e ON e.id = w.employee_id
           WHERE w.assembly_id = ?""",
        (asm["id"],),
    )
    asm["workers"] = workers
    return asm


async def get_contract_by_public_token(token: str) -> dict | None:
    """Возвращает договор по public_token + список сборок с их статусами."""
    if not token:
        return None
    c = await _fetch_one(
        """SELECT c.*,
                  ctr.name AS contractor_name,
                  e.full_name AS manager_name, e.short_name AS manager_short_name
           FROM contracts c
           LEFT JOIN contractors ctr ON ctr.id = c.contractor_id
           LEFT JOIN employees e ON e.id = c.manager_id
           WHERE c.public_token = ? AND c.is_active = 1""",
        (token,),
    )
    if not c:
        return None
    # Сборки по договору
    assemblies = await _fetch_all(
        """SELECT a.id, a.quantity, a.assembly_date, a.status, a.execution, a.ip_class,
                  m.name AS model_name, m.article AS model_article
           FROM assemblies a
           LEFT JOIN models m ON m.id = a.model_id
           WHERE a.contract_id = ? AND a.is_active = 1
           ORDER BY a.assembly_date DESC""",
        (c["id"],),
    )
    c["assemblies"] = assemblies
    return c


async def ensure_assembly_public_token(assembly_id: int) -> str | None:
    """Гарантирует наличие токена у сборки. Возвращает токен."""
    asm = await _fetch_one("SELECT public_token FROM assemblies WHERE id = ?", (assembly_id,))
    if not asm:
        return None
    if asm.get("public_token"):
        return asm["public_token"]
    import secrets
    token = secrets.token_urlsafe(8)
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            "UPDATE assemblies SET public_token = ? WHERE id = ?",
            (token, assembly_id),
        )
        await conn.commit()
    return token


async def ensure_contract_public_token(contract_id: int) -> str | None:
    """Гарантирует наличие токена у договора. Возвращает токен."""
    c = await _fetch_one("SELECT public_token FROM contracts WHERE id = ?", (contract_id,))
    if not c:
        return None
    if c.get("public_token"):
        return c["public_token"]
    import secrets
    token = secrets.token_urlsafe(8)
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            "UPDATE contracts SET public_token = ? WHERE id = ?",
            (token, contract_id),
        )
        await conn.commit()
    return token


# ============================================================
# ============ ЭТАП 22: ДОРАБОТКИ — ЗАМЕЧАНИЯ ============
# ============================================================

# ============================================================
# ============ ЭТАП 23: ТИПЫ РАБОТ ============
# ============================================================

WORK_TYPE_LABELS = {
    "assembly":      "Сборка",
    "repair":        "Ремонт",
    "commissioning": "Пусконаладка",
    "installation":  "Монтаж",
    "diagnostics":   "Диагностика",
    "design":        "Проектирование",
    "maintenance":   "ТО",
    "other":         "Прочее",
}

# Какие типы работ "не сборки" — для них не создаётся приход на склад
NON_ASSEMBLY_WORK_TYPES = {"repair", "commissioning", "installation", "diagnostics", "design", "maintenance", "other"}


DEFECT_TYPE_LABELS = {
    "defect":      "Дефект",
    "issue":       "Замечание",
    "improvement": "Улучшение",
    "question":    "Вопрос",
}

DEFECT_STATUS_LABELS = {
    "new":         "Новое",
    "in_progress": "В работе",
    "resolved":    "Решено",
    "rejected":    "Отклонено",
}


async def create_defect_report(
    description: str,
    type_: str = "defect",
    assembly_id: int | None = None,
    contract_id: int | None = None,
    author_name: str | None = None,
    author_phone: str | None = None,
    location: str | None = None,
) -> int:
    """Создаёт замечание. Возвращает ID.

    Если assembly_id указан и contract_id нет — попробуем подтянуть
    contract_id из самой сборки (если она привязана к договору).
    """
    if type_ not in DEFECT_TYPE_LABELS:
        type_ = "defect"
    # Авто-привязка к договору через сборку
    if assembly_id and not contract_id:
        row = await _fetch_one(
            "SELECT contract_id FROM assemblies WHERE id = ?", (assembly_id,)
        )
        if row and row.get("contract_id"):
            contract_id = row["contract_id"]
    return await _execute(
        """INSERT INTO defect_reports
           (assembly_id, contract_id, type, description, author_name, author_phone, location)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            assembly_id,
            contract_id,
            type_,
            description.strip(),
            (author_name or "").strip() or None,
            (author_phone or "").strip() or None,
            (location or "").strip() or None,
        ),
    )


async def add_defect_photo(defect_id: int, file_path: str, file_size: int, content_type: str) -> int:
    """Добавляет фото к замечанию. Возвращает ID."""
    return await _execute(
        """INSERT INTO defect_report_photos (defect_id, file_path, file_size, content_type)
           VALUES (?, ?, ?, ?)""",
        (defect_id, file_path, file_size, content_type),
    )


async def get_defect_photos(defect_id: int) -> list[dict]:
    return await _fetch_all(
        "SELECT * FROM defect_report_photos WHERE defect_id = ? ORDER BY id ASC",
        (defect_id,),
    )


async def count_defect_photos(defect_id: int) -> int:
    """Сколько фото уже у замечания (для лимита 5)."""
    n = await _fetch_scalar(
        "SELECT COUNT(*) FROM defect_report_photos WHERE defect_id = ?",
        (defect_id,),
    )
    return int(n or 0)


async def get_defect_by_id(defect_id: int) -> dict | None:
    """Возвращает замечание + связанные данные (сборка, договор, ответственный, фото)."""
    d = await _fetch_one(
        """SELECT r.*,
                  a.public_token AS assembly_token,
                  m.name         AS model_name,
                  m.article      AS model_article,
                  c.number       AS contract_number,
                  c.public_token AS contract_token,
                  ctr.name       AS contractor_name,
                  e.full_name    AS assignee_full_name,
                  e.short_name   AS assignee_short_name
           FROM defect_reports r
           LEFT JOIN assemblies   a   ON a.id   = r.assembly_id
           LEFT JOIN models       m   ON m.id   = a.model_id
           LEFT JOIN contracts    c   ON c.id   = r.contract_id
           LEFT JOIN contractors  ctr ON ctr.id = c.contractor_id
           LEFT JOIN employees    e   ON e.id   = r.assignee_id
           WHERE r.id = ?""",
        (defect_id,),
    )
    if not d:
        return None
    d["photos"] = await get_defect_photos(defect_id)
    return d


async def get_defect_reports(
    status: str | None = None,
    type_: str | None = None,
    assembly_id: int | None = None,
    contract_id: int | None = None,
    only_active: bool = True,
    limit: int = 500,
) -> list[dict]:
    """Список замечаний с фильтрами."""
    where = []
    params: list[Any] = []
    if only_active:
        where.append("r.is_active = 1")
    if status:
        where.append("r.status = ?")
        params.append(status)
    if type_:
        where.append("r.type = ?")
        params.append(type_)
    if assembly_id is not None:
        where.append("r.assembly_id = ?")
        params.append(assembly_id)
    if contract_id is not None:
        where.append("r.contract_id = ?")
        params.append(contract_id)
    sql = """SELECT r.*,
                    m.name    AS model_name,
                    m.article AS model_article,
                    c.number  AS contract_number,
                    ctr.name  AS contractor_name,
                    e.short_name AS assignee_short_name,
                    (SELECT COUNT(*) FROM defect_report_photos WHERE defect_id = r.id) AS photos_count
             FROM defect_reports r
             LEFT JOIN assemblies  a   ON a.id   = r.assembly_id
             LEFT JOIN models      m   ON m.id   = a.model_id
             LEFT JOIN contracts   c   ON c.id   = r.contract_id
             LEFT JOIN contractors ctr ON ctr.id = c.contractor_id
             LEFT JOIN employees   e   ON e.id   = r.assignee_id"""
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY r.created_at DESC"
    sql += f" LIMIT {int(limit)}"
    return await _fetch_all(sql, tuple(params))


async def update_defect_report(
    defect_id: int,
    status: str | None = None,
    resolution_note: str | None = None,
    assignee_id: int | None = None,
    updated_by_chat_id: int | None = None,
) -> bool:
    sets: list[str] = []
    values: list[Any] = []
    if status is not None and status in DEFECT_STATUS_LABELS:
        sets.append("status = ?")
        values.append(status)
    if resolution_note is not None:
        sets.append("resolution_note = ?")
        values.append((resolution_note or "").strip() or None)
    if assignee_id is not None:
        sets.append("assignee_id = ?")
        values.append(assignee_id if assignee_id else None)
    if not sets:
        return True
    sets.append("updated_at = datetime('now')")
    if updated_by_chat_id is not None:
        sets.append("updated_by_chat_id = ?")
        values.append(updated_by_chat_id)
    values.append(defect_id)
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            f"UPDATE defect_reports SET {', '.join(sets)} WHERE id = ?",
            tuple(values),
        )
        await conn.commit()
    return True


async def set_defect_active(defect_id: int, is_active: bool) -> bool:
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            "UPDATE defect_reports SET is_active = ?, updated_at = datetime('now') WHERE id = ?",
            (1 if is_active else 0, defect_id),
        )
        await conn.commit()
    return True


async def get_defects_summary() -> dict:
    """Сводка для виджета: сколько новых/в работе/решённых/отклонённых."""
    rows = await _fetch_all(
        """SELECT status, COUNT(*) AS cnt FROM defect_reports
           WHERE is_active = 1 GROUP BY status"""
    )
    out = {"new": 0, "in_progress": 0, "resolved": 0, "rejected": 0, "total": 0}
    for r in rows:
        s = r.get("status") or ""
        out[s] = int(r.get("cnt") or 0)
        out["total"] += out[s]
    return out


# ============================================================
# ============ ЭТАП 26: ОТГРУЗКИ ПО QR ========================
# ============================================================
#
# Архитектура:
# - boxes      : коробки с QR-токеном, привязаны к договору
# - shipments  : журнал отгрузок (assembly_id ИЛИ box_id)
# - Сборки уже имеют public_token (QR) и contract_id
# - Отгрузить можно сборку ИЛИ коробку — по одной за раз
# - Повторная отгрузка одного объекта запрещена (UNIQUE индексы)


# ---------- BOXES ----------

async def create_box(
    contract_id: int,
    name: str = "",
    description: str = "",
    created_by: int | None = None,
) -> dict:
    """Создаёт коробку с уникальным QR-токеном.

    Возвращает созданную запись (включая qr_token).
    """
    import secrets
    # Генерим короткий URL-safe токен (как у сборок)
    token = secrets.token_urlsafe(8)
    # На случай (крайне маловероятной) коллизии — пробуем до 5 раз
    for _ in range(5):
        existing = await _fetch_one("SELECT id FROM boxes WHERE qr_token = ?", (token,))
        if not existing:
            break
        token = secrets.token_urlsafe(8)

    box_id = await _execute(
        """INSERT INTO boxes (qr_token, contract_id, name, description, created_by)
           VALUES (?, ?, ?, ?, ?)""",
        (token, contract_id, name or "", description or "", created_by),
    )
    return await get_box_by_id(box_id)


async def get_box_by_id(box_id: int) -> dict | None:
    if not box_id:
        return None
    return await _fetch_one(
        """SELECT b.*, c.number AS contract_number, ctr.name AS contractor_name
           FROM boxes b
           LEFT JOIN contracts c    ON c.id   = b.contract_id
           LEFT JOIN contractors ctr ON ctr.id = c.contractor_id
           WHERE b.id = ? AND b.is_active = 1""",
        (box_id,),
    )


async def get_box_by_token(token: str) -> dict | None:
    """Возвращает коробку по QR-токену. Используется при сканировании."""
    if not token:
        return None
    return await _fetch_one(
        """SELECT b.*, c.number AS contract_number, ctr.name AS contractor_name
           FROM boxes b
           LEFT JOIN contracts c    ON c.id   = b.contract_id
           LEFT JOIN contractors ctr ON ctr.id = c.contractor_id
           WHERE b.qr_token = ? AND b.is_active = 1""",
        (token,),
    )


async def list_boxes_by_contract(contract_id: int) -> list[dict]:
    """Все коробки договора с пометкой отгружена ли."""
    return await _fetch_all(
        """SELECT b.*,
                  CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END AS is_shipped,
                  s.shipped_at, s.shipped_by
           FROM boxes b
           LEFT JOIN shipments s ON s.box_id = b.id
           WHERE b.contract_id = ? AND b.is_active = 1
           ORDER BY b.created_at""",
        (contract_id,),
    )


async def delete_box(box_id: int) -> bool:
    """Soft-delete: помечает коробку как is_active=0.

    Запрещено если коробка уже отгружена.
    """
    shipped = await _fetch_one("SELECT id FROM shipments WHERE box_id = ?", (box_id,))
    if shipped:
        return False
    await _execute("UPDATE boxes SET is_active = 0 WHERE id = ?", (box_id,))
    return True


async def update_box(
    box_id: int,
    name: str | None = None,
    description: str | None = None,
) -> bool:
    """Переименование/обновление коробки. Возвращает True если запись была."""
    current = await _fetch_one("SELECT * FROM boxes WHERE id = ?", (box_id,))
    if not current:
        return False
    fields = []
    values: list[Any] = []
    if name is not None:
        fields.append("name = ?")
        values.append((name or "").strip()[:200])
    if description is not None:
        fields.append("description = ?")
        values.append((description or "").strip()[:1000])
    if not fields:
        return True
    values.append(box_id)
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            f"UPDATE boxes SET {', '.join(fields)} WHERE id = ?",
            tuple(values),
        )
        await conn.commit()
    return True


async def count_boxes_in_contract(contract_id: int, include_deleted: bool = True) -> int:
    """Сколько коробок было создано в рамках договора.

    Используется для авто-генерации имени «Коробка #N». По умолчанию учитывает
    удалённые — чтобы номера никогда не повторялись.
    """
    if include_deleted:
        n = await _fetch_scalar(
            "SELECT COUNT(*) FROM boxes WHERE contract_id = ?", (contract_id,),
        )
    else:
        n = await _fetch_scalar(
            "SELECT COUNT(*) FROM boxes WHERE contract_id = ? AND is_active = 1",
            (contract_id,),
        )
    return int(n or 0)


# ============================================================
# ============ ЭТАП 30.1: СОДЕРЖИМОЕ КОРОБОК (box_items) ======
# ============================================================

BOX_ITEM_SOURCE_TYPES = ("assembly", "contract_item", "manual")


async def list_box_items(box_id: int) -> list[dict]:
    """Содержимое коробки (только активные позиции)."""
    return await _fetch_all(
        """SELECT bi.*, e.short_name AS created_by_name
           FROM box_items bi
           LEFT JOIN employees e ON e.auth_chat_id = bi.created_by OR e.telegram_id = bi.created_by
           WHERE bi.box_id = ? AND bi.is_active = 1
           ORDER BY bi.id""",
        (box_id,),
    )


async def create_box_item(
    box_id: int,
    name: str,
    qty: float = 1.0,
    unit: str = "шт.",
    source_type: str = "manual",
    source_id: int | None = None,
    comment: str = "",
    created_by: int | None = None,
) -> dict:
    """Добавляет позицию в коробку. Возвращает созданную запись."""
    if source_type not in BOX_ITEM_SOURCE_TYPES:
        source_type = "manual"
    name_clean = (name or "").strip()[:300]
    if not name_clean:
        raise ValueError("name is required")
    try:
        qty_clean = float(qty)
    except (TypeError, ValueError):
        qty_clean = 1.0
    unit_clean = (unit or "шт.").strip()[:30] or "шт."
    comment_clean = (comment or "").strip()[:1000]

    async with aiosqlite.connect(DB_PATH) as conn:
        cur = await conn.execute(
            """INSERT INTO box_items
               (box_id, source_type, source_id, name, qty, unit, comment, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (box_id, source_type, source_id, name_clean, qty_clean,
             unit_clean, comment_clean, created_by),
        )
        new_id = cur.lastrowid
        await conn.commit()
    item = await _fetch_one("SELECT * FROM box_items WHERE id = ?", (new_id,))
    return item


async def update_box_item(
    item_id: int,
    name: str | None = None,
    qty: float | None = None,
    unit: str | None = None,
    comment: str | None = None,
) -> bool:
    """Обновляет поля позиции коробки. Возвращает True если запись была."""
    current = await _fetch_one("SELECT * FROM box_items WHERE id = ?", (item_id,))
    if not current:
        return False
    fields, values = [], []
    if name is not None:
        v = (name or "").strip()[:300]
        if v:
            fields.append("name = ?")
            values.append(v)
    if qty is not None:
        try:
            fields.append("qty = ?")
            values.append(float(qty))
        except (TypeError, ValueError):
            pass
    if unit is not None:
        fields.append("unit = ?")
        values.append((unit or "шт.").strip()[:30] or "шт.")
    if comment is not None:
        fields.append("comment = ?")
        values.append((comment or "").strip()[:1000])
    if not fields:
        return True
    values.append(item_id)
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            f"UPDATE box_items SET {', '.join(fields)} WHERE id = ?",
            tuple(values),
        )
        await conn.commit()
    return True


async def delete_box_item(item_id: int) -> bool:
    """Soft-delete позиции коробки."""
    existing = await _fetch_one("SELECT id FROM box_items WHERE id = ?", (item_id,))
    if not existing:
        return False
    await _execute("UPDATE box_items SET is_active = 0 WHERE id = ?", (item_id,))
    return True


async def get_box_full(box_id: int) -> dict | None:
    """Возвращает коробку с полным контекстом для упаковочного листа:
    данные коробки, контрагент, номер договора, адрес доставки, содержимое."""
    box = await _fetch_one(
        """SELECT b.*,
                  c.number AS contract_number,
                  c.sign_date AS contract_sign_date,
                  c.delivery_address AS contract_delivery_address,
                  ctr.name AS contractor_name,
                  ctr.inn AS contractor_inn
           FROM boxes b
           LEFT JOIN contracts c ON c.id = b.contract_id
           LEFT JOIN contractors ctr ON ctr.id = c.contractor_id
           WHERE b.id = ?""",
        (box_id,),
    )
    if not box:
        return None
    box["items"] = await list_box_items(box_id)
    return box


# ============================================================
# ============ ЭТАП 30.2: ВНЕШНИЕ ОТГРУЗКИ ====================
# ============================================================

EXTERNAL_RECIPIENT_TYPES = ("inn", "individual")


async def create_external_shipment(
    items: list[dict],
    recipient_type: str,
    recipient_name: str,
    recipient_inn: str = "",
    recipient_comment: str = "",
    shipped_by: int | None = None,
) -> dict:
    """Создаёт отгрузку вне договора.

    items: [{'type': 'assembly'|'box', 'id': int}, ...]
    recipient_type: 'inn' или 'individual'
    Возвращает {'ok': bool, 'created': int, 'errors': [...]}.
    """
    if recipient_type not in EXTERNAL_RECIPIENT_TYPES:
        return {"ok": False, "created": 0, "errors": [f"bad recipient_type: {recipient_type}"]}
    rec_name = (recipient_name or "").strip()
    rec_comment = (recipient_comment or "").strip()
    rec_inn = (recipient_inn or "").strip()
    if not rec_name:
        return {"ok": False, "created": 0, "errors": ["recipient_name is required"]}
    if not rec_comment:
        return {"ok": False, "created": 0, "errors": ["recipient_comment is required"]}
    if recipient_type == "inn" and not rec_inn:
        return {"ok": False, "created": 0, "errors": ["recipient_inn is required for type=inn"]}
    if not items:
        return {"ok": False, "created": 0, "errors": ["no items"]}

    created = 0
    errors: list[str] = []
    async with aiosqlite.connect(DB_PATH) as conn:
        for it in items:
            t = it.get("type")
            iid = it.get("id")
            try:
                iid = int(iid)
            except (TypeError, ValueError):
                errors.append(f"bad id: {iid}")
                continue
            try:
                if t == "assembly":
                    await conn.execute(
                        """INSERT INTO shipments
                           (contract_id, assembly_id, box_id, shipped_by,
                            recipient_type, recipient_inn, recipient_name, recipient_comment)
                           VALUES (NULL, ?, NULL, ?, ?, ?, ?, ?)""",
                        (iid, shipped_by, recipient_type, rec_inn, rec_name, rec_comment),
                    )
                    created += 1
                elif t == "box":
                    await conn.execute(
                        """INSERT INTO shipments
                           (contract_id, assembly_id, box_id, shipped_by,
                            recipient_type, recipient_inn, recipient_name, recipient_comment)
                           VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?)""",
                        (iid, shipped_by, recipient_type, rec_inn, rec_name, rec_comment),
                    )
                    created += 1
                else:
                    errors.append(f"unknown type: {t}")
            except Exception as e:
                # UNIQUE constraint — уже отгружено
                errors.append(f"{t}#{iid}: {str(e)[:100]}")
        await conn.commit()
    return {"ok": (created > 0 and not errors), "created": created, "errors": errors}


async def list_external_shipments(limit: int = 100) -> list[dict]:
    """Список последних внешних отгрузок (recipient_type != 'contract')."""
    return await _fetch_all(
        """SELECT s.*,
                  a.id AS asm_id, m.name AS asm_model_name, m.article AS asm_model_article,
                  b.name AS box_name
           FROM shipments s
           LEFT JOIN assemblies a ON a.id = s.assembly_id
           LEFT JOIN models m ON m.id = a.model_id
           LEFT JOIN boxes b ON b.id = s.box_id
           WHERE s.contract_id IS NULL
             AND s.recipient_type IN ('inn', 'individual')
           ORDER BY s.shipped_at DESC
           LIMIT ?""",
        (limit,),
    )


# ---------- SHIPMENTS ----------

# Коды ответов для логики сканирования
SHIPMENT_OK            = "ok"               # принято
SHIPMENT_UNKNOWN       = "unknown"          # QR не найден ни в сборках, ни в коробках
SHIPMENT_NO_CONTRACT   = "no_contract"      # объект не привязан к договору
SHIPMENT_WRONG_CONTRACT = "wrong_contract"  # объект принадлежит другому договору
SHIPMENT_ALREADY       = "already_shipped"  # уже отгружено


async def resolve_qr_token(token: str) -> dict | None:
    """Универсальный поиск объекта по QR.

    Возвращает dict вида:
      {"type": "assembly" | "box", "id": int, "contract_id": int | None,
       "name": str, "qty": int, "data": {…исходная запись…}}
    либо None если токен не найден.
    """
    if not token:
        return None
    # Сначала ищем сборку (assemblies.public_token)
    asm = await _fetch_one(
        "SELECT * FROM assemblies WHERE public_token = ? AND is_active = 1",
        (token,),
    )
    if asm:
        # Имя — название модели (если есть)
        model = await _fetch_one("SELECT name, article FROM models WHERE id = ?", (asm.get("model_id"),)) \
            if asm.get("model_id") else None
        name_parts = []
        if model:
            if model.get("article"):
                name_parts.append(str(model["article"]))
            if model.get("name"):
                name_parts.append(str(model["name"]))
        name = " · ".join(name_parts) if name_parts else f"Сборка #{asm['id']}"
        return {
            "type": "assembly",
            "id": asm["id"],
            "contract_id": asm.get("contract_id"),
            "name": name,
            "qty": asm.get("qty") or 1,
            "data": asm,
        }
    # Потом ищем коробку
    box = await get_box_by_token(token)
    if box:
        return {
            "type": "box",
            "id": box["id"],
            "contract_id": box.get("contract_id"),
            "name": box.get("name") or f"Коробка #{box['id']}",
            "qty": 1,
            "data": box,
        }
    return None


async def scan_shipment(
    token: str,
    contract_id: int | None = None,
    shipped_by: int | None = None,
) -> dict:
    """Главная функция сканирования.

    Принимает QR-токен и (опционально) ожидаемый contract_id.
    Если contract_id не указан — берётся из объекта (если он привязан).

    Возвращает:
      {
        "ok": bool,
        "reason": код из SHIPMENT_*,
        "item": {…данные объекта…} | None,
        "contract_id": int | None,
        "progress": {"total": N, "shipped": K} | None,
        "shipment_id": int | None,
      }
    """
    obj = await resolve_qr_token(token)
    if not obj:
        return {"ok": False, "reason": SHIPMENT_UNKNOWN, "item": None,
                "contract_id": None, "progress": None, "shipment_id": None}

    obj_contract_id = obj.get("contract_id")

    # Если у объекта нет договора — отказ
    if not obj_contract_id:
        return {"ok": False, "reason": SHIPMENT_NO_CONTRACT, "item": obj,
                "contract_id": None, "progress": None, "shipment_id": None}

    # Если ожидался конкретный договор — проверяем
    if contract_id is not None and int(obj_contract_id) != int(contract_id):
        return {"ok": False, "reason": SHIPMENT_WRONG_CONTRACT, "item": obj,
                "contract_id": obj_contract_id, "progress": None, "shipment_id": None}

    # Используем contract_id объекта
    final_contract_id = int(obj_contract_id)

    # Проверка — уже отгружено?
    if obj["type"] == "assembly":
        existing = await _fetch_one(
            "SELECT id FROM shipments WHERE assembly_id = ?",
            (obj["id"],),
        )
    else:  # box
        existing = await _fetch_one(
            "SELECT id FROM shipments WHERE box_id = ?",
            (obj["id"],),
        )
    if existing:
        progress = await get_contract_shipment_progress(final_contract_id)
        return {"ok": False, "reason": SHIPMENT_ALREADY, "item": obj,
                "contract_id": final_contract_id, "progress": progress,
                "shipment_id": existing["id"]}

    # Создаём запись об отгрузке
    if obj["type"] == "assembly":
        shipment_id = await _execute(
            "INSERT INTO shipments (contract_id, assembly_id, shipped_by) VALUES (?, ?, ?)",
            (final_contract_id, obj["id"], shipped_by),
        )
    else:
        shipment_id = await _execute(
            "INSERT INTO shipments (contract_id, box_id, shipped_by) VALUES (?, ?, ?)",
            (final_contract_id, obj["id"], shipped_by),
        )

    progress = await get_contract_shipment_progress(final_contract_id)
    return {"ok": True, "reason": SHIPMENT_OK, "item": obj,
            "contract_id": final_contract_id, "progress": progress,
            "shipment_id": shipment_id}


async def get_contract_shipment_progress(contract_id: int) -> dict:
    """Краткая сводка: сколько всего позиций к отгрузке и сколько уже отгружено."""
    if not contract_id:
        return {"total": 0, "shipped": 0}
    # Все сборки договора (активные)
    total_assemblies = await _fetch_scalar(
        "SELECT COUNT(*) FROM assemblies WHERE contract_id = ? AND is_active = 1",
        (contract_id,),
    ) or 0
    # Все коробки договора (активные)
    total_boxes = await _fetch_scalar(
        "SELECT COUNT(*) FROM boxes WHERE contract_id = ? AND is_active = 1",
        (contract_id,),
    ) or 0
    # Отгружено
    shipped_assemblies = await _fetch_scalar(
        """SELECT COUNT(*) FROM shipments s
           JOIN assemblies a ON a.id = s.assembly_id
           WHERE s.contract_id = ? AND a.is_active = 1""",
        (contract_id,),
    ) or 0
    shipped_boxes = await _fetch_scalar(
        """SELECT COUNT(*) FROM shipments s
           JOIN boxes b ON b.id = s.box_id
           WHERE s.contract_id = ? AND b.is_active = 1""",
        (contract_id,),
    ) or 0
    total = int(total_assemblies) + int(total_boxes)
    shipped = int(shipped_assemblies) + int(shipped_boxes)
    return {"total": total, "shipped": shipped}


async def get_contract_shipment_status(contract_id: int) -> dict:
    """Полный статус отгрузки договора: прогресс + список позиций.

    Возвращает:
      {
        "contract_id": int,
        "total": int, "shipped": int,
        "is_complete": bool,
        "items": [
          {"type": "assembly"|"box", "id": int, "name": str, "qty": int,
           "shipped": bool, "shipped_at": str|None, "shipped_by": int|None,
           "qr_token": str},
          …
        ]
      }
    """
    if not contract_id:
        return {"contract_id": 0, "total": 0, "shipped": 0, "is_complete": True, "items": []}

    items: list[dict] = []

    # Сборки договора
    asm_rows = await _fetch_all(
        """SELECT a.id, a.public_token AS qr_token, a.qty,
                  m.name AS model_name, m.article AS model_article,
                  a.model_extra,
                  s.id AS shipment_id, s.shipped_at, s.shipped_by
           FROM assemblies a
           LEFT JOIN models m       ON m.id = a.model_id
           LEFT JOIN shipments s    ON s.assembly_id = a.id
           WHERE a.contract_id = ? AND a.is_active = 1
           ORDER BY a.id""",
        (contract_id,),
    )
    for r in asm_rows:
        name_parts = []
        if r.get("model_article"):
            name_parts.append(str(r["model_article"]))
        if r.get("model_name"):
            name_parts.append(str(r["model_name"]))
        if r.get("model_extra"):
            name_parts.append(str(r["model_extra"]))
        name = " · ".join(name_parts) if name_parts else f"Сборка #{r['id']}"
        items.append({
            "type": "assembly",
            "id": r["id"],
            "qr_token": r.get("qr_token"),
            "name": name,
            "qty": r.get("qty") or 1,
            "shipped": r.get("shipment_id") is not None,
            "shipped_at": r.get("shipped_at"),
            "shipped_by": r.get("shipped_by"),
        })

    # Коробки договора
    box_rows = await _fetch_all(
        """SELECT b.id, b.qr_token, b.name, b.description,
                  s.id AS shipment_id, s.shipped_at, s.shipped_by
           FROM boxes b
           LEFT JOIN shipments s ON s.box_id = b.id
           WHERE b.contract_id = ? AND b.is_active = 1
           ORDER BY b.id""",
        (contract_id,),
    )
    for r in box_rows:
        items.append({
            "type": "box",
            "id": r["id"],
            "qr_token": r.get("qr_token"),
            "name": r.get("name") or f"Коробка #{r['id']}",
            "qty": 1,
            "shipped": r.get("shipment_id") is not None,
            "shipped_at": r.get("shipped_at"),
            "shipped_by": r.get("shipped_by"),
        })

    total = len(items)
    shipped = sum(1 for x in items if x["shipped"])
    return {
        "contract_id": contract_id,
        "total": total,
        "shipped": shipped,
        "is_complete": (total > 0 and shipped == total),
        "items": items,
    }


async def undo_shipment(shipment_id: int) -> bool:
    """Удаляет запись об отгрузке (для случаев ошибочного скана).

    Возвращает True если запись была удалена.
    """
    if not shipment_id:
        return False
    cur_before = await _fetch_one("SELECT id FROM shipments WHERE id = ?", (shipment_id,))
    if not cur_before:
        return False
    await _execute("DELETE FROM shipments WHERE id = ?", (shipment_id,))
    return True


# ============================================================
# ============ ЭТАП 27: СПЕЦИФИКАЦИЯ ДОГОВОРА =================
# ============================================================


async def list_contract_items(contract_id: int) -> list[dict]:
    """Все позиции спецификации договора (активные), с подгрузкой модели."""
    return await _fetch_all(
        """SELECT ci.*,
                  m.name AS model_name,
                  m.article AS model_article,
                  m.extra AS model_extra
           FROM contract_items ci
           LEFT JOIN models m ON m.id = ci.model_id
           WHERE ci.contract_id = ? AND ci.is_active = 1
           ORDER BY ci.position_no, ci.id""",
        (contract_id,),
    )


async def get_contract_item(item_id: int) -> dict | None:
    return await _fetch_one(
        """SELECT ci.*,
                  m.name AS model_name,
                  m.article AS model_article,
                  m.extra AS model_extra
           FROM contract_items ci
           LEFT JOIN models m ON m.id = ci.model_id
           WHERE ci.id = ? AND ci.is_active = 1""",
        (item_id,),
    )


async def create_contract_item(
    contract_id: int,
    name: str,
    description: str = "",
    qty: float = 1,
    unit: str = "шт.",
    price: float = 0,
    position_no: int | None = None,
    model_id: int | None = None,
) -> dict:
    """Создаёт позицию спецификации.

    Если position_no не указан — автоматически = max + 1.
    Если указан model_id — name/unit/price могут быть взяты из модели.
    sum_amount пересчитывается из qty × price.
    """
    if position_no is None:
        max_no = await _fetch_scalar(
            "SELECT COALESCE(MAX(position_no), 0) FROM contract_items "
            "WHERE contract_id = ? AND is_active = 1",
            (contract_id,),
        ) or 0
        position_no = int(max_no) + 1

    # Если указан model_id и имя пустое — берём snapshot из модели
    if model_id and not name:
        m = await _fetch_one("SELECT name, article FROM models WHERE id = ?", (model_id,))
        if m:
            parts = []
            if m.get("article"):
                parts.append(str(m["article"]))
            if m.get("name"):
                parts.append(str(m["name"]))
            name = " · ".join(parts) if parts else f"Модель #{model_id}"

    sum_amount = float(qty or 0) * float(price or 0)

    item_id = await _execute(
        """INSERT INTO contract_items
           (contract_id, position_no, name, description, qty, unit, price, sum_amount, model_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (contract_id, position_no, name, description, qty, unit, price, sum_amount, model_id),
    )
    return await get_contract_item(item_id)


async def update_contract_item(
    item_id: int,
    name: str | None = None,
    description: str | None = None,
    qty: float | None = None,
    unit: str | None = None,
    price: float | None = None,
    position_no: int | None = None,
    model_id: int | None = None,
) -> dict | None:
    """Обновляет позицию. Пересчитывает sum_amount если меняется qty или price."""
    current = await get_contract_item(item_id)
    if not current:
        return None

    fields = []
    values: list[Any] = []
    if name is not None:
        fields.append("name = ?"); values.append(name)
    if description is not None:
        fields.append("description = ?"); values.append(description)
    if qty is not None:
        fields.append("qty = ?"); values.append(qty)
    if unit is not None:
        fields.append("unit = ?"); values.append(unit)
    if price is not None:
        fields.append("price = ?"); values.append(price)
    if position_no is not None:
        fields.append("position_no = ?"); values.append(position_no)
    if model_id is not None:
        fields.append("model_id = ?"); values.append(model_id if model_id else None)

    # Пересчёт sum_amount
    new_qty = float(qty if qty is not None else current["qty"] or 0)
    new_price = float(price if price is not None else current["price"] or 0)
    fields.append("sum_amount = ?"); values.append(new_qty * new_price)
    fields.append("updated_at = datetime('now')")

    if not fields:
        return current

    values.append(item_id)
    await _execute(
        f"UPDATE contract_items SET {', '.join(fields)} WHERE id = ?",
        tuple(values),
    )
    return await get_contract_item(item_id)


async def delete_contract_item(item_id: int) -> bool:
    """Soft-delete позиции."""
    item = await get_contract_item(item_id)
    if not item:
        return False
    await _execute(
        "UPDATE contract_items SET is_active = 0, updated_at = datetime('now') WHERE id = ?",
        (item_id,),
    )
    return True


async def get_contract_items_total(contract_id: int) -> float:
    """Сумма по всем активным позициям спецификации."""
    total = await _fetch_scalar(
        """SELECT COALESCE(SUM(sum_amount), 0) FROM contract_items
           WHERE contract_id = ? AND is_active = 1""",
        (contract_id,),
    )
    return float(total or 0)
