import asyncio
import logging
import os

import httpx
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import ReplyKeyboardRemove

logging.basicConfig(level=logging.INFO)

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
API_URL = os.environ.get("API_URL", "http://127.0.0.1:8000").rstrip("/")
INTERNAL_API_SECRET = os.environ.get("INTERNAL_API_SECRET", "")

bot = Bot(token=BOT_TOKEN)
storage = MemoryStorage()
dp = Dispatcher(storage=storage)


class Auth(StatesGroup):
    waiting_password = State()


async def _submit_join_request(chat_id: int, username: str | None, full_name: str | None, access_password: str) -> dict:
    if not INTERNAL_API_SECRET:
        return {"error": "internal", "message": "Сервер не настроен (INTERNAL_API_SECRET)."}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{API_URL}/api/telegram-join/internal/request",
                headers={"X-Internal-Secret": INTERNAL_API_SECRET},
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
        "📎 <b>Бухгалтерия:</b> ответьте файлом на уведомление о платеже — "
        "бот перешлёт документ менеджеру.",
        parse_mode="HTML",
    )


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
    if message.reply_to_message and message.reply_to_message.text:
        lines = message.reply_to_message.text.split("\n")
        for line in lines:
            if "Компания:" in line or "Описание:" in line or "Месяц:" in line:
                caption_text += line.strip() + "\n"

    forward_caption = (
        f"📎 <b>Документ от бухгалтерии</b>\n"
        f"👤 От: {message.from_user.full_name}\n"
    )
    if caption_text:
        forward_caption += f"\n{caption_text}"

    forwarded = 0
    for mgr in managers:
        mgr_chat_id = mgr.get("telegram_chat_id")
        if not mgr_chat_id:
            continue
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
            logging.warning(f"Failed to forward to manager {mgr_chat_id}: {e}")

    if forwarded > 0:
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
    if not INTERNAL_API_SECRET:
        logging.warning("INTERNAL_API_SECRET not set — заявки /start не смогут обращаться к API.")
    logging.info("Starting EnterDebt Telegram bot...")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
