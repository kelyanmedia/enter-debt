import asyncio
import logging
import os
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, ReplyKeyboardRemove

logging.basicConfig(level=logging.INFO)

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
DEFAULT_PASSWORD = "7777KM"

bot = Bot(token=BOT_TOKEN)
storage = MemoryStorage()
dp = Dispatcher(storage=storage)


class Auth(StatesGroup):
    waiting_password = State()


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
        "🔔 Бот автоматически отправляет уведомления о платежах.",
        parse_mode="HTML"
    )


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
