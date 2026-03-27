#!/bin/bash
# Резервное копирование базы данных Enter-Debt
# Использование:
#   На локальной машине:  bash scripts/backup_db.sh
#   На Hetzner сервере:   DATABASE_URL=postgresql://user:pass@host/db bash scripts/backup_db.sh
#
# Бэкапы сохраняются в db_backups/ (папка в .gitignore, не попадает в git)

set -e

BACKUP_DIR="$(dirname "$0")/../db_backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
FILE="$BACKUP_DIR/enterdebt_$TIMESTAMP.sql"

# Берём DATABASE_URL из переменной окружения или из backend/.env
if [ -z "$DATABASE_URL" ]; then
  if [ -f "$(dirname "$0")/../backend/.env" ]; then
    export $(grep -v '^#' "$(dirname "$0")/../backend/.env" | grep DATABASE_URL)
  fi
fi

if [ -z "$DATABASE_URL" ]; then
  DATABASE_URL="postgresql://enterdebt:enterdebt123@localhost:5432/enterdebt"
fi

echo "Backing up database to $FILE ..."
pg_dump "$DATABASE_URL" \
  --no-owner \
  --no-acl \
  --format=plain \
  --file="$FILE"

echo "Done: $FILE ($(du -sh "$FILE" | cut -f1))"

# Удаляем бэкапы старше 30 дней
find "$BACKUP_DIR" -name "enterdebt_*.sql" -mtime +30 -delete
echo "Old backups cleaned up."
