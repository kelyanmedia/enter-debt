/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
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
    return [
      {
        source: '/_next/static/(.*)',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/(.*)',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ]
  },

  async rewrites() {
    // Совпадает с README / uvicorn по умолчанию (:8000). Другой порт — задайте BACKEND_URL в .env.local
    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8000'
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
