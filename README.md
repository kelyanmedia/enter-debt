# EnterDebt — Система контроля дебиторки

## Стек 
- **Backend**: Python 3.12 + FastAPI + PostgreSQL + APScheduler
- **Frontend**: Next.js 14 + TypeScript + TailwindCSS
- **Деплой**: Docker Compose (Hetzner VPS или любой сервер)

---

## Три компании и раздельные базы PostgreSQL

Переключатель организации во фронте шлёт заголовок `X-Company-Slug`. Бэкенд открывает **разные** подключения только если у каждой компании **свой** URL.

- **По умолчанию** (`DATABASE_SEPARATE_DBS` не задан или `false`): все три slug используют **одну** базу из `DATABASE_URL` — данные **не** разделены (удобно для одной тестовой БД).
- **Прод с изоляцией**: в `.env` на сервере задайте `DATABASE_SEPARATE_DBS=true` и создайте в PostgreSQL две дополнительные базы с тем же пользователем, что и основная:
  - `enterdebt_whiteway`
  - `enterdebt_enter_group_media`  
  Имена подставляются автоматически из хоста/логина в `DATABASE_URL` (меняется только имя БД в пути). После перезапуска API таблицы создадутся в каждой базе при старте.

При старте в логах пишется строка `БД по компаниям` (пароль скрыт). Если все три совпадают и это PostgreSQL, в лог уходит **ERROR** с напоминанием включить разделение.

Подробнее — в корневом `.env.example` и пошагово для прод-сервера: [`docs/SERVER_SPLIT_DATABASES.md`](docs/SERVER_SPLIT_DATABASES.md).

---

## Быстрый старт (Docker)

> **Примечание**: PostgreSQL должна быть уже установлена на хосте (например, через FastPanel).
> Docker Compose **не** создаёт контейнер с базой данных — используется внешняя БД.

```bash
# 1. Клонировать / распаковать проект
cd enterdebt

# 2. Создать .env с подключением к БД и токеном бота
cat > .env <<EOF
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/dbname
TELEGRAM_BOT_TOKEN=ваш_токен
EOF

# 3. Запустить
docker-compose up --build

# Открыть в браузере:
# Фронтенд:  http://localhost:3000
# API docs:  http://localhost:8000/docs
```

---

## Тестовые аккаунты (создаются автоматически)

| Email | Пароль | Роль |
|---|---|---|
| admin@entergroup.uz | admin123 | Администратор |
| rustam@kelyanmedia.uz | rustam123 | Менеджер |
| alisher@kelyanmedia.uz | alisher123 | Менеджер |
| buh@entergroup.uz | buh123 | Бухгалтерия |

---

## Локальная разработка (без Docker)

### Backend
```bash
cd backend
pip install -r requirements.txt

# Запустить PostgreSQL локально или через Docker:
docker run -d -e POSTGRES_DB=enterdebt -e POSTGRES_USER=enterdebt \
  -e POSTGRES_PASSWORD=enterdebt_secret -p 5432:5432 postgres:16-alpine

# Создать .env
echo "DATABASE_URL=postgresql://enterdebt:enterdebt_secret@localhost:5432/enterdebt" > .env
echo "TELEGRAM_BOT_TOKEN=ваш_токен" >> .env

uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

В браузере: **http://127.0.0.1:8000/** — подсказка и ссылки; **http://127.0.0.1:8000/health** — только JSON (это не «сломанная» страница).

### Frontend
```bash
cd frontend
npm install

# Роут /api/* проксируется на бэкенд (порт как у uvicorn, обычно 8000)
cp .env.example .env.local   # или: echo "BACKEND_URL=http://127.0.0.1:8000" > .env.local

npm run dev
```

**Панель:** http://127.0.0.1:3000/login — не путать с портом **8000** (там только API).

---

## Настройка Telegram бота

1. Создать бота через @BotFather → получить TOKEN
2. Добавить TOKEN в `.env` файл
3. Узнать Chat ID каждого пользователя через @userinfobot
4. Прописать Chat ID в разделе Пользователи → Ред.

---

## API документация

После запуска доступна автодокументация:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

---

## Структура проекта

```
enterdebt/
├── backend/
│   ├── main.py          # Точка входа FastAPI
│   ├── models.py        # SQLAlchemy модели
│   ├── schemas.py       # Pydantic схемы
│   ├── routers.py       # Все API эндпоинты
│   ├── auth.py          # JWT авторизация
│   ├── notifications.py # Telegram уведомления
│   ├── scheduler.py     # Ежедневные проверки
│   ├── database.py      # Подключение к БД
│   └── config.py        # Настройки
├── frontend/
│   └── src/
│       ├── pages/       # Next.js страницы
│       ├── components/  # Layout, UI компоненты
│       ├── context/     # Auth context
│       └── lib/         # API клиент
└── docker-compose.yml
```

---

## Деплой на Hetzner VPS

```bash
# На сервере:
apt install docker.io docker-compose-plugin -y

# PostgreSQL должна быть уже установлена (FastPanel или вручную)

git clone ... && cd enterdebt

cat > .env <<EOF
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/dbname
TELEGRAM_BOT_TOKEN=токен
EOF

docker compose up -d --build

# Nginx (опционально, для домена):
# proxy_pass http://localhost:3000;  (фронт)
# proxy_pass http://localhost:8000;  (api)
```
