#!/bin/bash

echo "🚀 Запуск локального окружения..."

# Проверяем Docker
if ! docker info >/dev/null 2>&1; then
  echo ""
  echo "❌ Docker не запущен!"
  echo "   Открой Docker Desktop и запусти снова."
  echo ""
  exit 1
fi

echo "✅ Docker работает"
echo ""

# Останавливаем старые контейнеры
docker-compose -f docker-compose.local.yml down 2>/dev/null

# Запускаем
echo "⏳ Запуск db + backend + frontend..."
docker-compose -f docker-compose.local.yml up --build -d

echo ""
echo "⏳ Ждём пока всё поднимется (20 сек)..."
sleep 20

echo ""
echo "📊 Статус контейнеров:"
docker-compose -f docker-compose.local.yml ps

echo ""
echo "✅ Готово!"
echo ""
echo "   🌐 Фронтенд:  http://localhost:6000"
echo "   🔧 Backend:   http://localhost:8000"
echo "   📦 База:      localhost:5432"
echo ""
echo "   Логин:  admin@entergroup.uz"
echo "   Пароль: admin123"
echo ""
