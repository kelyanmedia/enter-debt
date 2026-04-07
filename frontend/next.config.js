/** @type {import('next').NextConfig} */
// Подхватываем .env.local до rewrites — иначе BACKEND_URL не попадает в process.env и прокси уйдёт на дефолт :8000
// (часто там другой процесс: /health есть, а /api/* — 404 → «API не найден» на логине).
const { loadEnvConfig } = require('@next/env')
loadEnvConfig(__dirname)

const nextConfig = {
  reactStrictMode: false,
  /** Иначе PackFileCache в dev ломается на ENOENT `.next/server` после 1-го запроса → все следующие GET дают 404. */
  webpack: (config, { dev }) => {
    if (dev) config.cache = false
    return config
  },
  allowedDevOrigins: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:6000',
    'http://127.0.0.1:6000',
    '*.pike.replit.dev',
    '*.replit.dev',
    '*.replit.app',
  ],

  // Запрещаем браузеру кэшировать статические чанки в dev-режиме.
  // Без этого после rm -rf .next браузер запрашивает старые URL → 404 → белый экран.
  async headers() {
    if (process.env.NODE_ENV !== 'development') return []
    // Только чанки: глобальный `/(.*)` в dev давал странные 404 на `/` и `/login` после компиляции `/_error`.
    return [
      {
        source: '/_next/static/(.*)',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]
  },

  async rewrites() {
    // Совпадает с README / uvicorn по умолчанию (:8000). Другой порт — задайте BACKEND_URL в .env.local
    // Убираем хвостовой /api — иначе получится .../api/api/auth/... и FastAPI ответит 404 Not Found
    let backendUrl = (process.env.BACKEND_URL || 'http://127.0.0.1:8000').trim().replace(/\/+$/, '')
    if (backendUrl.endsWith('/api')) {
      backendUrl = backendUrl.slice(0, -4).replace(/\/+$/, '')
    }
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
      // Те же ручки, что на FastAPI без префикса /api (nginx часто проксирует сюда после strip).
      {
        source: '/finance/:path*',
        destination: `${backendUrl}/finance/:path*`,
      },
      {
        source: '/dashboard/:path*',
        destination: `${backendUrl}/dashboard/:path*`,
      },
      {
        source: '/auth/:path*',
        destination: `${backendUrl}/auth/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
