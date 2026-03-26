import asyncio
import logging
import os
import httpx
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, ReplyKeyboardRemove

logging.basicConfig(level=logging.INFO)

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
API_URL = os.environ.get("API_URL", "http://127.0.0.1:8000")
DEFAULT_PASSWORD = "7777KM"

bot = Bot(token=BOT_TOKEN)
storage = MemoryStorage()
dp = Dispatcher(storage=storage)


class Auth(StatesGroup):
    waiting_password = State()


async def _get_db_users():
    """Fetch all users from internal API."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{API_URL}/api/users/internal")
            if r.status_code == 200:
                return r.json()
    except Exception as e:
        logging.warning(f"Failed to fetch users: {e}")
    return []


async def _get_manager_for_accountant(accountant_chat_id: int):
    """Find manager based on recent payment notification context."""
    return None


@dp.message(Command("start"))
async def cmd_start(message: types.Message, state: FSMContext):
    await state.set_state(Auth.waiting_password)
    await message.answer(
        "👋 Добро пожаловать в <b>EnterDebt</b> — систему контроля дебиторки.\n\n"
        "🔐 Введите пароль для получения вашего Telegram Chat ID:",
        parse_mode="HTML",
        reply_markup=ReplyKeyboardRemove()
    )


@dp.message(Auth.waiting_password)
async def check_password(message: types.Message, state: FSMContext):
    if message.text == DEFAULT_PASSWORD:
        await state.clear()
        chat_id = message.from_user.id
        username = message.from_user.username or "не указан"
        full_name = message.from_user.full_name or "—"

        await message.answer(
            f"✅ <b>Пароль принят!</b>\n\n"
            f"📋 <b>Ваши данные для регистрации в системе:</b>\n\n"
            f"👤 Имя: <b>{full_name}</b>\n"
            f"🆔 Telegram Chat ID: <code>{chat_id}</code>\n"
            f"👤 Username: @{username}\n\n"
            f"📌 <b>Скопируйте ваш Chat ID</b> (<code>{chat_id}</code>) и передайте администратору — "
            f"он внесёт вас в систему для получения уведомлений о платежах.\n\n"
            f"💡 Нажмите на ID чтобы скопировать.",
            parse_mode="HTML"
        )
    else:
        await message.answer(
            "❌ Неверный пароль. Попробуйте ещё раз или обратитесь к администратору."
        )


@dp.message(Command("id"))
async def cmd_id(message: types.Message):
    await message.answer(
        f"🆔 Ваш Telegram Chat ID: <code>{message.from_user.id}</code>",
        parse_mode="HTML"
    )


@dp.message(Command("help"))
async def cmd_help(message: types.Message):
    await message.answer(
        "📖 <b>Команды бота:</b>\n\n"
        "/start — Начало работы (требует пароль)\n"
        "/id — Показать ваш Chat ID\n"
        "/help — Эта справка\n\n"
        "🔔 Бот автоматически отправляет уведомления о платежах.\n\n"
        "📎 <b>Для бухгалтерии:</b> когда приходит уведомление о платеже, "
        "отправьте в ответ файл Акта и/или СФ — бот перешлёт его менеджеру.",
        parse_mode="HTML"
    )


@dp.message(F.document | F.photo)
async def handle_file_from_accountant(message: types.Message):
    """
    When accountant sends a file (SF/Act), forward it to the relevant manager.
    The message should be a reply to a payment notification.
    """
    sender_chat_id = message.from_user.id

    # Fetch users to identify sender role and find managers
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{API_URL}/api/users/internal/by-chat/{sender_chat_id}")
            if r.status_code != 200:
                await message.answer("⚠️ Вы не зарегистрированы в системе. Используйте /start.")
                return
            sender = r.json()
    except Exception:
        await message.answer("⚠️ Не удалось проверить вашу роль. Попробуйте позже.")
        return

    if sender.get("role") not in ("accountant", "admin"):
        return  # Only accountants forward files

    # Get all managers to forward to
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{API_URL}/api/users/internal/managers")
            managers = r.json() if r.status_code == 200 else []
    except Exception:
        managers = []

    if not managers:
        await message.answer("⚠️ Не найдено менеджеров для пересылки.")
        return

    # If reply to a specific notification, try to extract context from replied message
    caption_text = ""
    if message.reply_to_message and message.reply_to_message.text:
        # Extract company/description from the original notification
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
                    parse_mode="HTML"
                )
            elif message.photo:
                await bot.send_photo(
                    chat_id=mgr_chat_id,
                    photo=message.photo[-1].file_id,
                    caption=forward_caption,
                    parse_mode="HTML"
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
    logging.info("Starting EnterDebt Telegram bot...")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
