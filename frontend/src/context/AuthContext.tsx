import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import api from '@/lib/api'

interface User {
  id: number
  name: string
  email: string
  role: 'admin' | 'manager' | 'accountant'
  telegram_username?: string
  telegram_chat_id?: number | null
  is_active: boolean
}

interface AuthCtx {
  user: User | null
  loading: boolean
  login: (email: string, password: string, remember: boolean) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const Ctx = createContext<AuthCtx>({} as AuthCtx)

function getToken() {
  return localStorage.getItem('token') || sessionStorage.getItem('token')
}

function saveToken(token: string, remember: boolean) {
  if (remember) {
    localStorage.setItem('token', token)
    sessionStorage.removeItem('token')
  } else {
    sessionStorage.setItem('token', token)
    localStorage.removeItem('token')
  }
}

function clearToken() {
  localStorage.removeItem('token')
  sessionStorage.removeItem('token')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    api.get('auth/me')
      .then(r => setUser(r.data))
      .catch(() => clearToken())
      .finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string, remember: boolean) => {
    const emailKey = email.trim().toLowerCase()
    const r = await api.post('auth/login', { email: emailKey, password: password.trim() })
    saveToken(r.data.access_token, remember)
    if (remember) {
      localStorage.setItem('saved_email', emailKey)
    } else {
      localStorage.removeItem('saved_email')
    }
    const me = await api.get('auth/me')
    setUser(me.data)
  }

  const logout = () => {
    clearToken()
    setUser(null)
  }

  const refreshUser = async () => {
    const token = getToken()
    if (!token) return
    try {
      const r = await api.get('auth/me')
      setUser(r.data)
    } catch {
      /* ignore */
    }
  }

  return <Ctx.Provider value={{ user, loading, login, logout, refreshUser }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
