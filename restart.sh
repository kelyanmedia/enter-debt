#!/bin/bash
# Перезапуск всего стека Enter-Debt (бэкенд + фронтенд)
# Использование: bash restart.sh
# Запускает бэкенд на :8001, фронтенд на :3000

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "==> Останавливаем старые процессы..."
# Убиваем всё на нужных портах
for PORT in 3000 8001; do
  PIDS=$(lsof -ti TCP:$PORT 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "    Убиваем PID $PIDS (порт $PORT)"
    kill -9 $PIDS 2>/dev/null || true
  fi
done

# Дополнительно — убиваем все next dev процессы для этого проекта
pkill -f "next dev.*3000" 2>/dev/null || true
pkill -f "uvicorn app.main.*8001" 2>/dev/null || true
sleep 1

echo "==> Очищаем кэш фронтенда..."
rm -rf "$ROOT/frontend/.next"

echo "==> Запускаем бэкенд (порт 8001)..."
cd "$ROOT/backend"
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload \
  >> "$ROOT/backend.log" 2>&1 &
BACKEND_PID=$!
echo "    Backend PID=$BACKEND_PID"

sleep 2

echo "==> Запускаем фронтенд (порт 3000)..."
cd "$ROOT/frontend"
PORT=3000 npx next dev -p 3000 -H 127.0.0.1 \
  >> "$ROOT/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "    Frontend PID=$FRONTEND_PID"

echo ""
echo "==> Ждём готовности фронтенда (до 30 сек)..."
for i in $(seq 1 30); do
  sleep 1
  if curl -sf http://127.0.0.1:3000/ > /dev/null 2>&1; then
    echo "    ✓ Frontend готов за ${i}с"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "    ⚠ Фронтенд не ответил за 30с, проверьте frontend.log"
  fi
done

echo ""
echo "✅ Готово!"
echo "   Фронтенд:  http://localhost:3000"
echo "   Бэкенд:    http://localhost:8001"
echo "   Логи:      tail -f $ROOT/frontend.log"
echo "              tail -f $ROOT/backend.log"
