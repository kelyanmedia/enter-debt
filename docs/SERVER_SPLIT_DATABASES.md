# Разделение БД по компаниям на сервере

Сделать **на сервере** (после `git pull`), не в Cursor.

## 1. Узнать пользователя PostgreSQL из текущего `DATABASE_URL`

В `.env` на сервере строка вида:

`postgresql://USER:PASSWORD@HOST:PORT/enterdebt`

Запомните `USER` (и при необходимости подключитесь под суперпользователем `postgres` для шага 2).

## 2. Создать две базы (один раз)

Подключитесь к PostgreSQL **суперпользователем** (часто `sudo -u postgres psql` или через панель хостинга → SQL).

Замените `YOUR_APP_USER` на пользователя из `DATABASE_URL`:

```sql
CREATE DATABASE enterdebt_whiteway;
CREATE DATABASE enterdebt_enter_group_media;

GRANT ALL PRIVILEGES ON DATABASE enterdebt_whiteway TO YOUR_APP_USER;
GRANT ALL PRIVILEGES ON DATABASE enterdebt_enter_group_media TO YOUR_APP_USER;
```

Если базы уже есть — шаг пропустите.

## 3. Включить разделение в `.env` на сервере

В тот же файл `.env`, что читает Docker/backend, добавьте или измените:

```env
DATABASE_SEPARATE_DBS=true
```

Не удаляйте существующий `DATABASE_URL` — от него берутся хост, порт, логин и пароль; подставятся только имена БД `enterdebt_whiteway` и `enterdebt_enter_group_media`.

## 4. Перезапуск

```bash
# пример для docker compose из корня проекта
docker compose down && docker compose up -d --build
```

После старта API сам создаст таблицы в новых базах.

## 5. Проверка

В логах backend при старте должны быть **три разные** строки подключения в сообщении `БД по компаниям` (пароли скрыты). Не должно быть ERROR про «ОДНУ PostgreSQL-базу».

## Если что-то пошло не так

- Ошибка «database does not exist» — базы из шага 2 не созданы или опечатка в имени.
- Ошибка прав — проверьте `GRANT` для того же пользователя, что в `DATABASE_URL`.
- Нужна одна база на всех (тест) — `DATABASE_SEPARATE_DBS=false` и не создавайте отдельные БД.
