from __future__ import annotations

import asyncio
import calendar
import html
import logging
import os
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command, CommandObject
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardRemove

logging.basicConfig(level=logging.INFO)

# Совпадает с app.core.config.Settings.INTERNAL_API_SECRET (пустой env → тот же дефолт, что у API)
_DEFAULT_INTERNAL_SECRET = "change_internal_secret_in_production"


def _internal_secret() -> str:
    raw = (os.environ.get("INTERNAL_API_SECRET") or "").strip()
    return raw if raw else _DEFAULT_INTERNAL_SECRET


BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
API_URL = os.environ.get("API_URL", "http://127.0.0.1:8000").rstrip("/")
# Какая БД/компания у бота (kelyanmedia | whiteway | enter_group_media). Совпадает с X-Company-Slug в API.
BOT_COMPANY_SLUG = (os.environ.get("BOT_COMPANY_SLUG") or "kelyanmedia").strip().lower().replace("-", "_")

TASK_REMINDER_TZ = ZoneInfo("Asia/Tashkent")


def _api_headers(extra: dict | None = None) -> dict:
    h = {"X-Company-Slug": BOT_COMPANY_SLUG}
    if extra:
        h.update(extra)
    return h

bot = Bot(token=BOT_TOKEN)
storage = MemoryStorage()
dp = Dispatcher(storage=storage)


class Auth(StatesGroup):
    waiting_password = State()


class DividendFlow(StatesGroup):
    waiting_category = State()


async def _submit_join_request(chat_id: int, username: str | None, full_name: str | None, access_password: str) -> dict:
    secret = _internal_secret()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{API_URL}/api/telegram-join/internal/request",
                headers=_api_headers({"X-Internal-Secret": secret}),
                json={
                    "chat_id": chat_id,
                    "username": username,
                    "full_name": full_name,
                    "access_password": access_password,
                },
            )
            if r.status_code == 401:
                return {"error": "unauthorized", "message": "Ошибка связи с сервером (секрет)."}
            data = r.json()
            if r.status_code >= 400:
                detail = data.get("detail")
                if isinstance(detail, list):
                    detail = str(detail)
                return {"error": "api", "message": detail or "Ошибка сервера"}
            return data
    except Exception as e:
        logging.exception("join request failed")
        return {"error": "network", "message": str(e)}


async def _fetch_telegram_cc_chats(route_manager_id: Optional[int]) -> list[int]:
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            params = {}
            if route_manager_id is not None:
                params["route_manager_id"] = route_manager_id
            r = await client.get(
                f"{API_URL}/api/users/internal/telegram-cc-chats",
                params=params or None,
                headers=_api_headers(),
            )
            if r.status_code != 200:
                return []
            data = r.json()
            return [int(x) for x in data.get("chat_ids", [])]
    except Exception:
        return []


async def _fetch_administration_chats() -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                f"{API_URL}/api/users/internal/administration",
                headers=_api_headers(),
            )
            if r.status_code != 200:
                return []
            data = r.json()
            return data if isinstance(data, list) else []
    except Exception:
        return []


async def _fetch_administration_status() -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                f"{API_URL}/api/users/internal/administration-status",
                headers=_api_headers(),
            )
            if r.status_code != 200:
                return []
            data = r.json()
            return data if isinstance(data, list) else []
    except Exception:
        return []


def _parse_decimal_amount(raw: str) -> Decimal:
    txt = (raw or "").strip().replace(" ", "")
    if "," in txt and "." not in txt:
        txt = txt.replace(",", ".")
    else:
        txt = txt.replace(",", "")
    return Decimal(txt)


def _parse_d_command(raw: str) -> tuple[Decimal, Decimal, str]:
    """
    Формат:
      /d 2500000
      /d 2500000 аванс себе
      /d 120 usd
      /d 120$ на личные расходы
    """
    text = (raw or "").strip()
    m = re.match(r"^\s*([\d\s.,]+)\s*([a-zA-Z$а-яА-Я]*)\s*(.*)$", text)
    if not m:
        raise ValueError("Не удалось распознать сумму.")
    amount_raw = (m.group(1) or "").strip()
    currency_raw = (m.group(2) or "").strip().lower()
    note = (m.group(3) or "").strip()
    if not amount_raw:
        raise ValueError("Не указана сумма.")
    try:
        amount = _parse_decimal_amount(amount_raw)
    except (InvalidOperation, ValueError):
        raise ValueError("Сумма указана в неверном формате.")
    if amount <= 0:
        raise ValueError("Сумма должна быть больше нуля.")

    usd_markers = {"usd", "$", "дол", "доллар", "доллара", "долларов"}
    is_usd = any(currency_raw.startswith(x) for x in usd_markers)
    if is_usd:
        return Decimal("0"), amount, note
    return amount, Decimal("0"), note


async def _fetch_dividend_settings(chat_id: int) -> dict:
    secret = _internal_secret()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{API_URL}/api/users/internal/telegram-dividend-settings/{chat_id}",
                headers=_api_headers({"X-Internal-Secret": secret}),
            )
            if r.status_code >= 400:
                try:
                    detail = r.json().get("detail")
                except Exception:
                    detail = None
                return {"error": detail or "Не удалось загрузить настройки /d"}
            return r.json()
    except Exception as e:
        logging.exception("telegram dividend settings failed")
        return {"error": str(e)}


def _dividend_category_keyboard(rows: list[dict], default_slug: str) -> InlineKeyboardMarkup:
    items = []
    for row in rows:
        slug = str(row.get("slug") or "")
        label = str(row.get("label") or slug)
        prefix = "✓ " if slug == default_slug else ""
        items.append([InlineKeyboardButton(text=f"{prefix}{label}", callback_data=f"edd:{slug}")])
    items.append([InlineKeyboardButton(text="Отмена", callback_data="edd:cancel")])
    return InlineKeyboardMarkup(inline_keyboard=items)


@dp.message(Command("start"))
async def cmd_start(message: types.Message, state: FSMContext):
    await state.set_state(Auth.waiting_password)
    await message.answer(
        "👋 Добро пожаловать в <b>EnterDebt</b> — контроль дебиторки.\n\n"
        "🔐 Введите <b>пароль доступа</b> (его выдаёт администратор). После проверки "
        "заявка уйдёт на модерацию.",
        parse_mode="HTML",
        reply_markup=ReplyKeyboardRemove(),
    )


@dp.message(Auth.waiting_password)
async def check_password(message: types.Message, state: FSMContext):
    pwd = (message.text or "").strip()
    if not pwd:
        await message.answer("Введите пароль текстом.")
        return

    chat_id = message.from_user.id
    username = message.from_user.username
    full_name = message.from_user.full_name

    result = await _submit_join_request(chat_id, username, full_name, pwd)
    if "error" in result:
        await message.answer(f"❌ {result.get('message', 'Ошибка')}")
        return

    await state.clear()
    status = result.get("status")
    msg = result.get("message", "Готово.")

    if status == "already_registered":
        await message.answer(
            f"ℹ️ {msg}\n\nЕсли нужен доступ с другого аккаунта — обратитесь к администратору.",
            parse_mode="HTML",
        )
        return
    if status in ("created", "resubmitted", "already_pending"):
        extra = (
            "\n\nПосле одобрения администратором вы получите сообщение здесь "
            "(менеджеру — ссылка и логин в панель; бухгалтерии — только уведомления в этом чате)."
        )
        await message.answer(f"✅ {msg}{extra}", parse_mode="HTML")
        return

    await message.answer(f"✅ {msg}", parse_mode="HTML")


@dp.message(Command("id"))
async def cmd_id(message: types.Message):
    await message.answer(
        f"🆔 Ваш Telegram Chat ID: <code>{message.from_user.id}</code>",
        parse_mode="HTML",
    )


@dp.message(Command("help"))
async def cmd_help(message: types.Message):
    await message.answer(
        "📖 <b>Команды:</b>\n\n"
        "/start — ввести пароль и отправить заявку на доступ\n"
        "/id — показать Chat ID\n"
        "/pay &lt;текст&gt; — админ отправляет заявку на оплату в Telegram администрации\n"
        "/d &lt;сумма&gt; [&lt;комментарий&gt;] — только для администратора: расход в ДДС, бот спросит категорию P&amp;L\n"
        "/help — справка\n\n"
        "После одобрения заявки менеджер получает ссылку и логин в панель; "
        "бухгалтерия работает через уведомления в этом чате.\n\n"
        "📎 <b>Бухгалтерия:</b> ответьте <b>файлом на то сообщение</b>, которое пришло по акту или оплате — "
        "документ уйдёт менеджеру, отправившему пуш (или закреплённому за партнёром, если пуш от админа). "
        "Без ответа на такое сообщение рассылка всем менеджерам.\n\n"
        "💬 <b>Текст:</b> менеджер или админ пишет сообщение боту — оно уходит бухгалтерии. "
        "Другие менеджеры это не видят. Бухгалтерия отвечает <b>цитатой (reply)</b> на такое сообщение — "
        "ответ уходит только автору.",
        parse_mode="HTML",
    )


@dp.message(Command("pay"))
async def cmd_pay(message: types.Message, command: CommandObject):
    raw = (command.args or "").strip()
    if not raw:
        await message.answer(
            "Напишите команду так: <code>/pay текст заявки</code>\n\n"
            "Пример: <code>/pay Оплатить подрядчику 2 500 000 сум за апрель</code>",
            parse_mode="HTML",
        )
        return

    sender_chat_id = message.from_user.id
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(f"{API_URL}/api/users/internal/by-chat/{sender_chat_id}", headers=_api_headers())
            if r.status_code != 200:
                await message.answer("⚠️ Вы не зарегистрированы. Используйте /start.")
                return
            sender = r.json()
    except Exception:
        await message.answer("⚠️ Не удалось проверить профиль. Попробуйте позже.")
        return

    if sender.get("role") != "admin":
        await message.answer("⚠️ Команда /pay доступна только администратору.")
        return

    admins_request = (
        f"💸 <b>Заявка на оплату</b>\n"
        f"👤 <b>{html.escape(sender.get('name') or message.from_user.full_name or 'Администратор')}</b>\n"
        f"🏢 Компания: <code>{html.escape(BOT_COMPANY_SLUG)}</code>\n\n"
        f"{html.escape(raw)}"
    )
    if len(admins_request) > 3800:
        admins_request = admins_request[:3700] + "\n\n<i>…текст обрезан (слишком длинный).</i>"

    recipients = await _fetch_administration_chats()
    if not recipients:
        status_rows = await _fetch_administration_status()
        if not status_rows:
            await message.answer(
                "⚠️ В этой компании нет активных пользователей роли «Администрация»."
            )
            return
        missing_chat = [u for u in status_rows if not u.get("has_telegram_chat")]
        if missing_chat:
            lines = []
            for u in missing_chat[:6]:
                uname = u.get("telegram_username")
                suffix = f" (@{uname})" if uname else ""
                lines.append(f"• {u.get('name', '—')}{suffix}")
            more = ""
            if len(missing_chat) > 6:
                more = f"\n…и ещё {len(missing_chat) - 6}"
            await message.answer(
                "⚠️ Заявку некому доставить: у пользователей администрации не привязан Telegram Chat ID.\n\n"
                "Найдены пользователи:\n"
                f"{chr(10).join(lines)}{more}\n\n"
                "Нужно, чтобы они зашли в бота через /start и были одобрены, либо чтобы Chat ID был указан в их карточке."
            )
            return
        await message.answer("⚠️ Не найдено пользователей администрации с привязанным Telegram.")
        return

    ok = 0
    for user in recipients:
        cid = user.get("telegram_chat_id")
        if not cid:
            continue
        try:
            await bot.send_message(int(cid), admins_request, parse_mode="HTML")
            ok += 1
        except Exception as e:
            logging.warning(f"/pay delivery to administration {cid} failed: {e}")

    if ok:
        await message.answer(f"✅ Заявка отправлена администрации ({ok}).")
    else:
        await message.answer("⚠️ Не удалось доставить заявку администрации.")


@dp.message(Command("d"))
async def cmd_dividend(message: types.Message, command: CommandObject, state: FSMContext):
    raw = (command.args or "").strip()
    if not raw:
        await message.answer(
            "Напишите команду так: <code>/d сумма [комментарий]</code>\n\n"
            "Примеры:\n"
            "• <code>/d 2500000 Забрал из прибыли</code>\n"
            "• <code>/d 120 usd Личные расходы</code>\n\n"
            "После этого бот спросит категорию P&amp;L. Дата записи — сегодняшняя.",
            parse_mode="HTML",
        )
        return

    sender_chat_id = message.from_user.id
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(f"{API_URL}/api/users/internal/by-chat/{sender_chat_id}", headers=_api_headers())
            if r.status_code != 200:
                await message.answer("⚠️ Вы не зарегистрированы. Используйте /start.")
                return
            sender = r.json()
    except Exception:
        await message.answer("⚠️ Не удалось проверить профиль. Попробуйте позже.")
        return

    if sender.get("role") != "admin":
        await message.answer("⚠️ Команда /d доступна только администратору.")
        return

    try:
        amount_uzs, amount_usd, note = _parse_d_command(raw)
    except ValueError as e:
        await message.answer(
            "⚠️ " + str(e) + "\n\n"
            "Пример: <code>/d 2500000 Забрал из прибыли</code> или <code>/d 120 usd</code>",
            parse_mode="HTML",
        )
        return

    settings = await _fetch_dividend_settings(sender_chat_id)
    if settings.get("error"):
        await message.answer(f"⚠️ Не удалось загрузить настройки /d: {settings['error']}")
        return

    allowed_rows = settings.get("allowed_categories") or []
    if not isinstance(allowed_rows, list) or not allowed_rows:
        await message.answer("⚠️ Для команды /d не настроены доступные категории. Откройте «Профиль» в панели.")
        return

    default_slug = str(settings.get("default_category") or "dividends")
    await state.set_state(DividendFlow.waiting_category)
    await state.update_data(
        dividend_amount_uzs=str(amount_uzs),
        dividend_amount_usd=str(amount_usd),
        dividend_note=note or None,
    )
    await message.answer(
        "Выберите категорию P&amp;L для этой записи.\n"
        f"Дата будет: <code>{datetime.now(TASK_REMINDER_TZ).date().isoformat()}</code>",
        parse_mode="HTML",
        reply_markup=_dividend_category_keyboard(allowed_rows, default_slug),
    )


@dp.callback_query(F.data.startswith("edd:"))
async def dividend_category_callback(query: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    if await state.get_state() != DividendFlow.waiting_category.state:
        await query.answer("Уже неактуально.", show_alert=True)
        return

    payload_key = (query.data or "").split(":", 1)[1] if ":" in (query.data or "") else ""
    if payload_key == "cancel":
        await state.clear()
        await query.answer("Отменено.")
        try:
            await query.message.edit_reply_markup(reply_markup=None)
        except Exception:
            pass
        return

    amount_uzs = str(data.get("dividend_amount_uzs") or "0")
    amount_usd = str(data.get("dividend_amount_usd") or "0")
    note = data.get("dividend_note")
    secret = _internal_secret()
    payload = {
        "chat_id": query.from_user.id,
        "amount_uzs": amount_uzs,
        "amount_usd": amount_usd,
        "flow_category": payload_key,
        "note": note or None,
        "payment_method": "transfer",
        "entry_date": datetime.now(TASK_REMINDER_TZ).date().isoformat(),
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{API_URL}/api/users/internal/telegram-dividend",
                headers=_api_headers({"X-Internal-Secret": secret}),
                json=payload,
            )
            if r.status_code >= 400:
                try:
                    detail = r.json().get("detail")
                except Exception:
                    detail = None
                await query.answer("Ошибка записи", show_alert=True)
                await query.message.answer(f"⚠️ Не удалось записать операцию: {detail or 'ошибка сервера'}")
                return
            created = r.json() if r.status_code == 200 else {}
    except Exception:
        await query.answer("Ошибка связи", show_alert=True)
        await query.message.answer("⚠️ Не удалось связаться с сервером. Попробуйте позже.")
        return

    await state.clear()
    try:
        await query.message.edit_reply_markup(reply_markup=None)
    except Exception:
        pass

    uzs_dec = Decimal(amount_uzs)
    usd_dec = Decimal(amount_usd)
    uzs_text = f"{uzs_dec:,.2f}".replace(",", " ") if uzs_dec > 0 else "0.00"
    usd_text = f"{usd_dec:,.2f}".replace(",", " ") if usd_dec > 0 else "0.00"
    await query.answer("Записано.")
    await query.message.answer(
        "✅ Зафиксировано в ДДС.\n"
        f"Категория: <b>{html.escape(created.get('flow_category_label') or payload_key)}</b>\n"
        f"Строка: <b>{html.escape(created.get('label') or 'Изъятие прибыли (/d)')}</b>\n"
        f"Дата: <code>{html.escape(created.get('entry_date') or '—')}</code>\n"
        f"Месяц: <code>{html.escape(created.get('period_month') or '—')}</code>\n"
        f"Сумма: <code>{uzs_text} UZS</code> / <code>{usd_text} USD</code>",
        parse_mode="HTML",
    )


@dp.callback_query(F.data.startswith("edtk:"))
async def employee_tasks_reminder_callback(query: types.CallbackQuery):
    """Ответы на напоминание «внесли все задачи?» (рассылка с бэкенда по cron)."""
    parts = (query.data or "").split(":")
    if len(parts) != 3 or parts[0] != "edtk" or parts[1] not in ("y", "n"):
        return

    chat_id = query.from_user.id
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(f"{API_URL}/api/users/internal/by-chat/{chat_id}", headers=_api_headers())
            if r.status_code != 200:
                await query.answer("Сначала привяжите аккаунт через /start.", show_alert=True)
                return
            sender = r.json()
    except Exception:
        await query.answer("Не удалось проверить профиль. Попробуйте позже.", show_alert=True)
        return

    if sender.get("role") != "employee":
        await query.answer("Это напоминание только для сотрудников.", show_alert=True)
        return

    today = datetime.now(TASK_REMINDER_TZ).date()
    is_yes = parts[1] == "y"

    if is_yes:
        await query.answer("Спасибо за ответ.")
    else:
        await query.answer("Постарайтесь внести задачи в кабинет до конца месяца.")

    try:
        await query.message.edit_reply_markup(reply_markup=None)
    except Exception:
        pass

    if is_yes:
        last = calendar.monthrange(today.year, today.month)[1]
        if today.day == last:
            await query.message.answer(
                "✅ Если вы ввели все задачи — отлично. Скоро вам проведут оплату в платёжный день.",
                parse_mode="HTML",
            )


_REPLY_TO_MGR_RE = re.compile(r"ed_reply_to_manager:(\d+)")


def _extract_reply_manager_id(reply: Optional[types.Message]) -> Optional[int]:
    if not reply:
        return None
    chunks = []
    for attr in ("html_text", "text", "caption"):
        raw = getattr(reply, attr, None)
        if raw:
            chunks.append(raw)
    blob = "\n".join(chunks)
    m = _REPLY_TO_MGR_RE.search(blob)
    if not m:
        return None
    uid = int(m.group(1))
    return uid if uid > 0 else None


_ROUTE_RE = re.compile(r"ed_route_user_id:(\d+)")


def _extract_route_user_id(reply: Optional[types.Message]) -> Optional[int]:
    if not reply:
        return None
    chunks = []
    for attr in ("html_text", "text", "caption"):
        raw = getattr(reply, attr, None)
        if raw:
            chunks.append(raw)
    blob = "\n".join(chunks)
    m = _ROUTE_RE.search(blob)
    if not m:
        return None
    uid = int(m.group(1))
    return uid if uid > 0 else None


@dp.message(F.text)
async def bridge_text_manager_accountant(message: types.Message, state: FSMContext):
    """Менеджер/админ → бухгалтерия; бухгалтерия (reply) → тот же менеджер."""
    if await state.get_state() in (Auth.waiting_password.state, DividendFlow.waiting_category.state):
        return

    raw = (message.text or "").strip()
    if not raw or raw.startswith("/"):
        return

    sender_chat_id = message.from_user.id
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(f"{API_URL}/api/users/internal/by-chat/{sender_chat_id}", headers=_api_headers())
            if r.status_code != 200:
                await message.answer("⚠️ Вы не зарегистрированы. Используйте /start.")
                return
            sender = r.json()
    except Exception:
        await message.answer("⚠️ Не удалось проверить профиль. Попробуйте позже.")
        return

    role = sender.get("role")
    sender_id = int(sender.get("id", 0))
    sender_name = sender.get("name") or message.from_user.full_name or "—"

    # Ответ цитатой на пуш «Акт/оплата» даёт ed_route_user_id; ответ на пересланное от менеджера — ed_reply_to_manager
    rid = _extract_reply_manager_id(message.reply_to_message)
    route_uid = _extract_route_user_id(message.reply_to_message)
    mgr_dest = rid or route_uid

    # Бухгалтерия (или админ с цитатой на сообщение с адресом менеджера): текст → в личку менеджеру
    if role == "accountant" or (role == "admin" and mgr_dest):
        if not mgr_dest:
            await message.answer(
                "💬 <b>Как ответить менеджеру текстом</b>\n\n"
                "1️⃣ На пуш из бота про <b>акт или оплату</b> — нажмите «Ответить» на <b>это</b> сообщение "
                "(внизу пуша есть строка <code>ed_route_user_id:…</code>) и напишите текст.\n\n"
                "2️⃣ На сообщение менеджера, которое начинается с «Сообщение» — там строка "
                "<code>ed_reply_to_manager:…</code> — тоже ответьте <b>цитатой</b>.\n\n"
                "📎 Чтобы отправить <b>файл</b> (Акт/СФ), ответьте вложением на тот же пуш про акт/оплату.",
                parse_mode="HTML",
            )
            return
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(
                    f"{API_URL}/api/users/internal/telegram-chat-by-user/{mgr_dest}",
                    headers=_api_headers(),
                )
                if r.status_code != 200:
                    await message.answer("⚠️ У менеджера нет привязанного Telegram.")
                    return
                target = r.json()
                tchat = int(target["telegram_chat_id"])
        except Exception:
            await message.answer("⚠️ Не удалось найти чат менеджера.")
            return

        body = (
            f"📥 <b>Сообщение от бухгалтерии</b>\n"
            f"👤 {html.escape(message.from_user.full_name or 'Бухгалтерия')}\n\n"
            f"{html.escape(raw)}"
        )
        try:
            await bot.send_message(tchat, body, parse_mode="HTML")
            cc_pref = "📨 <i>Копия (контроль)</i>\n\n"
            for cid in await _fetch_telegram_cc_chats(mgr_dest):
                try:
                    await bot.send_message(cid, cc_pref + body, parse_mode="HTML")
                except Exception as ce:
                    logging.warning(f"telegram cc to {cid} failed: {ce}")
            await message.answer("✅ Сообщение отправлено менеджеру в личный чат с ботом.")
        except Exception as e:
            logging.warning(f"bridge accountant→manager failed: {e}")
            await message.answer("⚠️ Не удалось доставить сообщение менеджеру.")
        return

    # Менеджер или админ → бухгалтерия (видят только они и бухи; другие менеджеры не в цепочке)
    if role not in ("manager", "admin"):
        return

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(f"{API_URL}/api/users/internal/accountants", headers=_api_headers())
            if r.status_code != 200:
                await message.answer("⚠️ Список бухгалтерии недоступен.")
                return
            accountants = r.json()
    except Exception:
        await message.answer("⚠️ Не удалось связаться с сервером.")
        return

    if not accountants:
        await message.answer("⚠️ В системе нет бухгалтеров с привязанным Telegram.")
        return

    escaped = html.escape(raw)
    block = (
        f"💬 <b>Сообщение</b> — ответьте <b>цитатой</b>, чтобы ответить автору\n"
        f"👤 <b>{html.escape(sender_name)}</b> · user id <code>{sender_id}</code>\n"
        f"<code>ed_reply_to_manager:{sender_id}</code>\n\n"
        f"{escaped}"
    )
    if len(block) > 3800:
        block = block[:3700] + "\n\n<i>…текст обрезан (слишком длинный).</i>"
    ok = 0
    for acc in accountants:
        cid = acc.get("telegram_chat_id")
        if not cid:
            continue
        try:
            await bot.send_message(int(cid), block, parse_mode="HTML")
            ok += 1
        except Exception as e:
            logging.warning(f"bridge to accountant {cid} failed: {e}")

    if ok:
        route_cc = sender_id if role in ("manager", "admin") else None
        cc_block = "📨 <i>Копия (контроль)</i>\n\n" + block
        for cid in await _fetch_telegram_cc_chats(route_cc):
            try:
                await bot.send_message(cid, cc_block, parse_mode="HTML")
            except Exception as ce:
                logging.warning(f"telegram cc to {cid} failed: {ce}")
        await message.answer(
            f"✅ Сообщение отправлено бухгалтерии ({ok}). "
            f"Другие менеджеры его не видят — переписка только через этого бота.",
        )
    else:
        await message.answer("⚠️ Не удалось доставить сообщение бухгалтерии.")


@dp.message(F.document | F.photo)
async def handle_file_from_accountant(message: types.Message):
    sender_chat_id = message.from_user.id

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{API_URL}/api/users/internal/by-chat/{sender_chat_id}", headers=_api_headers())
            if r.status_code != 200:
                await message.answer("⚠️ Вы не зарегистрированы. Используйте /start.")
                return
            sender = r.json()
    except Exception:
        await message.answer("⚠️ Не удалось проверить роль. Попробуйте позже.")
        return

    role = sender.get("role")
    sender_id = int(sender.get("id", 0) or 0)
    sender_name = sender.get("name") or message.from_user.full_name or "—"
    if role not in ("accountant", "admin", "manager"):
        return

    # Менеджер (или админ без reply) -> бухгалтерия + копии администраторам по настройкам
    if role == "manager" or (role == "admin" and not message.reply_to_message):
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(f"{API_URL}/api/users/internal/accountants", headers=_api_headers())
                if r.status_code != 200:
                    await message.answer("⚠️ Список бухгалтерии недоступен.")
                    return
                accountants = r.json()
        except Exception:
            await message.answer("⚠️ Не удалось связаться с сервером.")
            return

        if not accountants:
            await message.answer("⚠️ В системе нет бухгалтеров с привязанным Telegram.")
            return

        contract_hint = (
            "📌 Если это договор/контракт для Didox — бухгалтерия может ответить <b>файлом цитатой</b> "
            "на это сообщение, и файл уйдёт обратно только этому менеджеру."
        )
        caption = (
            f"📎 <b>Файл от менеджера</b>\n"
            f"👤 <b>{html.escape(sender_name)}</b> · user id <code>{sender_id}</code>\n"
            f"<code>ed_reply_to_manager:{sender_id}</code>\n\n"
            f"{contract_hint}"
        )
        delivered = 0
        for acc in accountants:
            cid = acc.get("telegram_chat_id")
            if not cid:
                continue
            try:
                if message.document:
                    await bot.send_document(
                        chat_id=int(cid),
                        document=message.document.file_id,
                        caption=caption,
                        parse_mode="HTML",
                    )
                elif message.photo:
                    await bot.send_photo(
                        chat_id=int(cid),
                        photo=message.photo[-1].file_id,
                        caption=caption,
                        parse_mode="HTML",
                    )
                delivered += 1
            except Exception as e:
                logging.warning(f"manager file to accountant {cid} failed: {e}")

        cc_caption = "📨 <i>Копия (контроль)</i>\n\n" + caption
        for cid in await _fetch_telegram_cc_chats(sender_id):
            try:
                if message.document:
                    await bot.send_document(
                        chat_id=cid,
                        document=message.document.file_id,
                        caption=cc_caption,
                        parse_mode="HTML",
                    )
                elif message.photo:
                    await bot.send_photo(
                        chat_id=cid,
                        photo=message.photo[-1].file_id,
                        caption=cc_caption,
                        parse_mode="HTML",
                    )
            except Exception as ce:
                logging.warning(f"telegram cc manager file to {cid} failed: {ce}")

        if delivered:
            await message.answer(f"✅ Файл отправлен бухгалтерии ({delivered}) и в контрольные копии по настройкам.")
        else:
            await message.answer("⚠️ Не удалось доставить файл бухгалтерии.")
        return

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{API_URL}/api/users/internal/managers", headers=_api_headers())
            managers = r.json() if r.status_code == 200 else []
    except Exception:
        managers = []

    if not managers:
        await message.answer("⚠️ Не найдено менеджеров для пересылки.")
        return

    caption_text = ""
    reply_msg = message.reply_to_message
    if reply_msg:
        for raw in (
            getattr(reply_msg, "text", None),
            getattr(reply_msg, "html_text", None),
            getattr(reply_msg, "caption", None),
        ):
            if not raw:
                continue
            for line in raw.split("\n"):
                if any(k in line for k in ("Компания:", "Описание:", "Месяц:", "Компания", "Описание")):
                    caption_text += line.strip() + "\n"

    forward_caption = (
        f"📎 <b>Документ от бухгалтерии</b>\n"
        f"👤 От: {message.from_user.full_name}\n"
    )
    if caption_text:
        forward_caption += f"\n{caption_text}"

    route_uid = _extract_route_user_id(reply_msg)
    reply_manager_uid = _extract_reply_manager_id(reply_msg)
    target_chats: list[int] = []
    mode = "broadcast"

    direct_uid = route_uid or reply_manager_uid
    if direct_uid is not None:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"{API_URL}/api/users/internal/telegram-chat-by-user/{direct_uid}", headers=_api_headers())
                if r.status_code == 200:
                    data = r.json()
                    cid = data.get("telegram_chat_id")
                    if cid:
                        target_chats = [int(cid)]
                        mode = "single"
        except Exception:
            pass

    if mode == "single" and not target_chats:
        await message.answer(
            "⚠️ В уведомлении указан менеджер, но у него нет привязанного Telegram — пересылаю всем менеджерам.",
        )
        mode = "broadcast"

    if mode == "broadcast":
        if not reply_msg:
            await message.answer(
                "⚠️ Лучше ответить файлом <b>на сообщение</b> об акте или оплате — тогда документ уйдёт нужному менеджеру. "
                "Сейчас пересылаю всем менеджерам с Telegram.",
                parse_mode="HTML",
            )
        target_chats = list(
            {int(m["telegram_chat_id"]) for m in managers if m.get("telegram_chat_id")}
        )

    forwarded = 0
    for mgr_chat_id in target_chats:
        try:
            if message.document:
                await bot.send_document(
                    chat_id=mgr_chat_id,
                    document=message.document.file_id,
                    caption=forward_caption,
                    parse_mode="HTML",
                )
            elif message.photo:
                await bot.send_photo(
                    chat_id=mgr_chat_id,
                    photo=message.photo[-1].file_id,
                    caption=forward_caption,
                    parse_mode="HTML",
                )
            forwarded += 1
        except Exception as e:
            logging.warning(f"Failed to forward to {mgr_chat_id}: {e}")

    cc_route = direct_uid if mode == "single" else None
    cc_cap = "📨 <i>Копия (контроль)</i>\n\n" + forward_caption
    for cid in await _fetch_telegram_cc_chats(cc_route):
        try:
            if message.document:
                await bot.send_document(
                    chat_id=cid,
                    document=message.document.file_id,
                    caption=cc_cap,
                    parse_mode="HTML",
                )
            elif message.photo:
                await bot.send_photo(
                    chat_id=cid,
                    photo=message.photo[-1].file_id,
                    caption=cc_cap,
                    parse_mode="HTML",
                )
        except Exception as ce:
            logging.warning(f"telegram cc file to {cid} failed: {ce}")

    if forwarded > 0:
        if mode == "single":
            await message.answer("✅ Документ переслан менеджеру, которому адресован пуш.")
        else:
            await message.answer(f"✅ Документ переслан {forwarded} менеджер(ам).")
    else:
        await message.answer("⚠️ Не удалось переслать — у менеджеров не указан Telegram Chat ID.")


async def send_notification(chat_id: int, text: str):
    try:
        await bot.send_message(chat_id, text, parse_mode="HTML")
        return True
    except Exception as e:
        logging.error(f"Failed to send notification to {chat_id}: {e}")
        return False


async def main():
    if not BOT_TOKEN:
        logging.error("BOT_TOKEN not set! Bot will not start.")
        return
    logging.info(
        "EnterDebt bot: INTERNAL_API_SECRET=%s (override via env)",
        "custom" if (os.environ.get("INTERNAL_API_SECRET") or "").strip() else "default",
    )
    logging.info("Starting EnterDebt Telegram bot...")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
