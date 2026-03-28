import asyncio
import logging
import os
import re
from typing import Optional

import httpx
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import ReplyKeyboardRemove

logging.basicConfig(level=logging.INFO)

# Совпадает с app.core.config.Settings.INTERNAL_API_SECRET (пустой env → тот же дефолт, что у API)
_DEFAULT_INTERNAL_SECRET = "change_internal_secret_in_production"


def _internal_secret() -> str:
    raw = (os.environ.get("INTERNAL_API_SECRET") or "").strip()
    return raw if raw else _DEFAULT_INTERNAL_SECRET


BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
API_URL = os.environ.get("API_URL", "http://127.0.0.1:8000").rstrip("/")

bot = Bot(token=BOT_TOKEN)
storage = MemoryStorage()
dp = Dispatcher(storage=storage)


class Auth(StatesGroup):
    waiting_password = State()


async def _submit_join_request(chat_id: int, username: str | None, full_name: str | None, access_password: str) -> dict:
    secret = _internal_secret()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{API_URL}/api/telegram-join/internal/request",
                headers={"X-Internal-Secret": secret},
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
        "/help — справка\n\n"
        "После одобрения заявки менеджер получает ссылку и логин в панель; "
        "бухгалтерия работает через уведомления в этом чате.\n\n"
        "📎 <b>Бухгалтерия:</b> ответьте <b>файлом на то сообщение</b>, которое пришло по акту или оплате — "
        "документ уйдёт менеджеру, отправившему пуш (или закреплённому за партнёром, если пуш от админа). "
        "Без ответа на такое сообщение рассылка всем менеджерам.",
        parse_mode="HTML",
    )


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


@dp.message(F.document | F.photo)
async def handle_file_from_accountant(message: types.Message):
    sender_chat_id = message.from_user.id

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{API_URL}/api/users/internal/by-chat/{sender_chat_id}")
            if r.status_code != 200:
                await message.answer("⚠️ Вы не зарегистрированы. Используйте /start.")
                return
            sender = r.json()
    except Exception:
        await message.answer("⚠️ Не удалось проверить роль. Попробуйте позже.")
        return

    if sender.get("role") not in ("accountant", "admin"):
        return

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{API_URL}/api/users/internal/managers")
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
    target_chats: list[int] = []
    mode = "broadcast"

    if route_uid is not None:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"{API_URL}/api/users/internal/telegram-chat-by-user/{route_uid}")
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
