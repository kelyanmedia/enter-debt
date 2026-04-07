import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/**
 * Нужен только как стабильный "пин" для dev-сборки Next.js:
 * без файла middleware у этого проекта периодически не создаётся
 * manifest, после чего страницы начинают отвечать 404.
 *
 * Matcher указывает на несуществующий probe-route, поэтому
 * реальный runtime-трафик этот middleware не затрагивает.
 */
export function middleware(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: ['/__ed_mw_probe'],
}
