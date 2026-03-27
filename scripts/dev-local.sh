#!/usr/bin/env bash
# EnterDebt API на :8001 + Next (порт из PORT, по умолчанию 3000). Пример: PORT=3055 ./scripts/dev-local.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PORT="${PORT:-3000}"
export BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8001}"
cd "$ROOT/backend"
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8001 &
UV_PID=$!
cleanup() { kill "$UV_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
sleep 2
echo "   API:  http://127.0.0.1:8001  →  фронт: http://127.0.0.1:${PORT}"
cd "$ROOT/frontend"
exec npm run dev
