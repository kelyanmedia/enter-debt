# EnterDebt — Система контроля дебиторки

## Стек 
- **Backend**: Python 3.12 + FastAPI + PostgreSQL + APScheduler
- **Frontend**: Next.js 14 + TypeScript + TailwindCSS
- **Деплой**: Docker Compose (Hetzner VPS или любой сервер)

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

uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install

# Создать .env.local
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local

npm run dev
```

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
