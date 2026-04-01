/** Текущая компания (отдельная БД на бэкенде). Slug совпадает с X-Company-Slug. */

export const DEFAULT_COMPANY_SLUG = 'kelyanmedia'

const SLUG_KEY = 'ed_company_slug'

export function tokenStorageKey(slug: string) {
  return `ed_token_${slug}`
}

export function getCompanySlug(): string {
  if (typeof window === 'undefined') return DEFAULT_COMPANY_SLUG
  return localStorage.getItem(SLUG_KEY) || DEFAULT_COMPANY_SLUG
}

export function setCompanySlug(slug: string) {
  localStorage.setItem(SLUG_KEY, slug)
}

export function getTokenForSlug(slug: string) {
  return localStorage.getItem(tokenStorageKey(slug)) || sessionStorage.getItem(tokenStorageKey(slug))
}

export function saveTokenForSlug(slug: string, token: string, remember: boolean) {
  const k = tokenStorageKey(slug)
  localStorage.removeItem(k)
  sessionStorage.removeItem(k)
  if (remember) localStorage.setItem(k, token)
  else sessionStorage.setItem(k, token)
}

export function clearTokenForSlug(slug: string) {
  localStorage.removeItem(tokenStorageKey(slug))
  sessionStorage.removeItem(tokenStorageKey(slug))
}

/** Перенос старых ключей token / sessionStorage → ed_token_kelyanmedia */
export function migrateLegacyToken() {
  if (typeof window === 'undefined') return
  const legacyFromLocal = localStorage.getItem('token')
  const legacyFromSession = sessionStorage.getItem('token')
  const legacy = legacyFromLocal || legacyFromSession
  if (!legacy) return
  const slug = getCompanySlug()
  if (getTokenForSlug(slug)) {
    localStorage.removeItem('token')
    sessionStorage.removeItem('token')
    return
  }
  const remember = !!legacyFromLocal
  saveTokenForSlug('kelyanmedia', legacy, remember)
  localStorage.removeItem('token')
  sessionStorage.removeItem('token')
}

export const COMPANY_LABELS: Record<string, string> = {
  kelyanmedia: 'KelyanMedia',
  whiteway: 'WhiteWay',
  enter_group_media: 'Enter Group Media',
}

export function companyDisplayName(slug: string) {
  return COMPANY_LABELS[slug] || slug
}
