/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  allowedDevOrigins: [
    'http://localhost:3000',
    'http://localhost:6000',
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
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8001'
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
