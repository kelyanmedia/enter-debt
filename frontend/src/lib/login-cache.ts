/** Локальное сохранение данных входа по компании (slug). */

export type SavedLoginCreds = {
  email: string
  password: string
}

const CREDS_PREFIX = 'ed_login_creds_'
const REMEMBER_KEY = 'ed_remember_login'

function credsKey(slug: string) {
  return `${CREDS_PREFIX}${slug}`
}

export function getRememberLogin(): boolean {
  if (typeof window === 'undefined') return true
  const raw = localStorage.getItem(REMEMBER_KEY)
  if (raw === null) return true
  return raw === '1'
}

export function setRememberLogin(remember: boolean) {
  localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0')
}

export function getSavedLoginCreds(slug: string): SavedLoginCreds | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(credsKey(slug))
    if (!raw) return null
    const data = JSON.parse(raw) as SavedLoginCreds
    if (!data?.email || typeof data.password !== 'string') return null
    return { email: data.email, password: data.password }
  } catch {
    return null
  }
}

export function saveLoginCreds(slug: string, email: string, password: string) {
  if (typeof window === 'undefined') return
  const payload: SavedLoginCreds = {
    email: email.trim().toLowerCase(),
    password,
  }
  localStorage.setItem(credsKey(slug), JSON.stringify(payload))
}

export function clearLoginCreds(slug: string) {
  if (typeof window === 'undefined') return
  localStorage.removeItem(credsKey(slug))
}

export function clearAllLoginCreds() {
  if (typeof window === 'undefined') return
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i)
    if (k?.startsWith(CREDS_PREFIX)) keys.push(k)
  }
  keys.forEach((k) => localStorage.removeItem(k))
}
