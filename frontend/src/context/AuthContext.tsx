import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import { useRouter } from 'next/router'
import axios from 'axios'
import api from '@/lib/api'
import {
  clearTokenForSlug,
  DEFAULT_COMPANY_SLUG,
  getCompanySlug,
  getTokenForSlug,
  migrateLegacyToken,
  saveTokenForSlug,
  setCompanySlug as persistCompanySlug,
} from '@/lib/company'

interface User {
  id: number
  name: string
  email: string
  role: 'admin' | 'manager' | 'accountant' | 'financier' | 'administration' | 'employee'
  telegram_username?: string
  telegram_chat_id?: number | null
  is_active: boolean
  can_view_subscriptions?: boolean
  can_view_accesses?: boolean
  /** Администрация: пункт «Ввод ДДС» без просмотра отчёта */
  can_enter_cash_flow?: boolean
  payment_details?: string | null
  payment_details_updated_at?: string | null
  /** Только сотрудник: переключение компаний в кабинете (иначе закреплена компания входа). */
  multi_company_access?: boolean
  /** Только админ: какие организации в переключателе; undefined/null = все (как раньше). */
  admin_accessible_company_slugs?: string[] | null
  /** Только сотрудник: рекламный бюджет клиента — в P&L учитывается только доля «услуга». */
  is_ad_budget_employee?: boolean
}

export interface CompanyOption {
  slug: string
  name: string
}

interface AuthCtx {
  user: User | null
  loading: boolean
  /** После F5: токен есть, но /auth/me не ответил (сеть/таймаут) — не сбрасываем сессию. */
  authBootstrapFailed: boolean
  retryAuthBootstrap: () => void
  companySlug: string
  companies: CompanyOption[]
  /** Список для переключателя (у админа может быть уже полного списка). */
  workspaceCompanies: CompanyOption[]
  login: (email: string, password: string, remember: boolean) => Promise<User>
  logout: () => void
  refreshUser: () => Promise<void>
  switchCompany: (slug: string) => Promise<void>
}

const Ctx = createContext<AuthCtx>({} as AuthCtx)

const FALLBACK_COMPANIES: CompanyOption[] = [
  { slug: 'kelyanmedia', name: 'KelyanMedia' },
  { slug: 'whiteway', name: 'WhiteWay' },
  { slug: 'enter_group_media', name: 'Enter Group Media' },
]

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [authBootstrapFailed, setAuthBootstrapFailed] = useState(false)
  const [companySlug, setCompanySlugState] = useState(DEFAULT_COMPANY_SLUG)
  const [companies, setCompanies] = useState<CompanyOption[]>(FALLBACK_COMPANIES)

  const workspaceCompanies = useMemo(() => {
    if (!user || user.role !== 'admin') return companies
    const slugs = user.admin_accessible_company_slugs
    if (slugs == null || slugs.length === 0) return companies
    return companies.filter((c) => slugs.includes(c.slug))
  }, [companies, user])

  const applyMeError = useCallback((err: unknown, slug: string) => {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      clearTokenForSlug(slug)
      setAuthBootstrapFailed(false)
      return
    }
    setAuthBootstrapFailed(true)
  }, [])

  const retryAuthBootstrap = useCallback(() => {
    const slug = getCompanySlug()
    if (!getTokenForSlug(slug)) {
      setAuthBootstrapFailed(false)
      return
    }
    setLoading(true)
    setAuthBootstrapFailed(false)
    api
      .get<User>('auth/me')
      .then((r) => {
        setUser(r.data)
        setAuthBootstrapFailed(false)
      })
      .catch((err) => applyMeError(err, slug))
      .finally(() => setLoading(false))
  }, [applyMeError])

  useEffect(() => {
    migrateLegacyToken()
    const slug = getCompanySlug()
    setCompanySlugState(slug)
    api
      .get<CompanyOption[]>('auth/companies')
      .then((r) => setCompanies(r.data))
      .catch(() => setCompanies(FALLBACK_COMPANIES))
    const token = getTokenForSlug(slug)
    if (!token) {
      setLoading(false)
      return
    }
    api
      .get<User>('auth/me')
      .then((r) => {
        setUser(r.data)
        setAuthBootstrapFailed(false)
      })
      .catch((err) => applyMeError(err, slug))
      .finally(() => setLoading(false))
  }, [applyMeError])

  const login = async (email: string, password: string, remember: boolean) => {
    const emailKey = email.trim().toLowerCase()
    const slug = getCompanySlug()
    const r = await api.post<{ access_token: string }>('auth/login', {
      email: emailKey,
      password: password.trim(),
    })
    saveTokenForSlug(slug, r.data.access_token, remember)
    if (remember) {
      localStorage.setItem('saved_email', emailKey)
    } else {
      localStorage.removeItem('saved_email')
    }
    const me = await api.get<User>('auth/me')
    setUser(me.data)
    setAuthBootstrapFailed(false)
    setCompanySlugState(slug)
    return me.data
  }

  const logout = () => {
    clearTokenForSlug(getCompanySlug())
    setUser(null)
  }

  const refreshUser = async () => {
    const slug = getCompanySlug()
    const token = getTokenForSlug(slug)
    if (!token) return
    try {
      const r = await api.get<User>('auth/me')
      setUser(r.data)
    } catch {
      /* ignore */
    }
  }

  const switchCompany = useCallback(
    async (slug: string) => {
      if (!slug || slug === getCompanySlug()) return
      if (user?.role === 'employee' && user.multi_company_access !== true) return
      if (
        user?.role === 'admin' &&
        user.admin_accessible_company_slugs != null &&
        user.admin_accessible_company_slugs.length > 0 &&
        !user.admin_accessible_company_slugs.includes(slug)
      ) {
        return
      }
      persistCompanySlug(slug)
      setCompanySlugState(slug)
      const tok = getTokenForSlug(slug)
      if (!tok) {
        setUser(null)
        await router.push('/login')
        return
      }
      setLoading(true)
      try {
        const r = await api.get<User>('auth/me')
        setUser(r.data)
        if (router.pathname === '/login') {
          await router.push(r.data.role === 'employee' ? '/my-work' : '/')
        } else if (
          r.data.role === 'employee' &&
          router.pathname !== '/my-work' &&
          router.pathname !== '/profile'
        ) {
          await router.replace('/my-work')
        }
      } catch {
        setUser(null)
        await router.push('/login')
      } finally {
        setLoading(false)
      }
    },
    [router, user?.role, user?.multi_company_access, user?.admin_accessible_company_slugs]
  )

  return (
    <Ctx.Provider
      value={{
        user,
        loading,
        authBootstrapFailed,
        retryAuthBootstrap,
        companySlug,
        companies,
        workspaceCompanies,
        login,
        logout,
        refreshUser,
        switchCompany,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export const useAuth = () => useContext(Ctx)
