import { useState, FormEvent, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/context/AuthContext'
import { getCompanySlug, setCompanySlug as persistCompanySlug, companyDisplayName, DEFAULT_COMPANY_SLUG } from '@/lib/company'

/** Совпадает с backend/app/core/config.py (ADMIN_EMAIL / ADMIN_PASSWORD) и seed в main.py */
const DEV_LOGIN_EMAIL = 'agasi@gmail.com'
const DEV_LOGIN_PASSWORD = 'KM2026admin_controlpanel'

export default function LoginPage() {
  const { login, companies } = useAuth()
  const router = useRouter()
  const isDev = process.env.NODE_ENV === 'development'
  const [email, setEmail] = useState(isDev ? DEV_LOGIN_EMAIL : '')
  const [password, setPassword] = useState(isDev ? DEV_LOGIN_PASSWORD : '')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [workspace, setWorkspace] = useState(DEFAULT_COMPANY_SLUG)

  useEffect(() => {
    setWorkspace(getCompanySlug())
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem('saved_email')
    if (saved) {
      setEmail(saved)
      setRemember(true)
    }
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const u = await login(email, password, remember)
      router.push(
        u.role === 'employee' ? '/my-work' : u.role === 'financier' ? '/ceo' : '/',
      )
    } catch (err: any) {
      const status = err?.response?.status
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((x: { msg?: string }) => x?.msg).filter(Boolean).join(' ') : ''
      const notFound =
        status === 404 ||
        msg === 'Not Found' ||
        (typeof err?.response?.data === 'string' && err.response.data.includes('Not Found'))
      if (notFound) {
        setError(
          'API не найден (404). Чаще всего Next проксирует не на тот порт: в frontend/.env.local задайте BACKEND_URL=http://127.0.0.1:ПОРТ (без /api), где запущен uvicorn этого проекта. Проверка: curl http://127.0.0.1:ПОРТ/api/auth/companies должен вернуть JSON, не 404. После правки .env.local обязательно перезапустите npm run dev.',
        )
      } else if (status === 500 || status === 503 || !status) {
        setError(
          !status
            ? 'Нет ответа от API. Запустите бэкенд и проверьте в frontend/.env.local переменную BACKEND_URL (должен совпадать с портом uvicorn). После смены порта перезапустите npm run dev.'
            : 'Сервер недоступен. Попробуйте позже.'
        )
      } else if (msg) {
        setError(msg)
      } else {
        setError('Неверный email или пароль')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6fa' }}>
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e8e9ef', padding: '40px 36px', width: 380, boxShadow: '0 4px 24px rgba(0,0,0,.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 32 }}>
          <img
            src="/kelyanmedia-logo.png"
            alt="KelyanMedia"
            style={{ height: 48, width: 'auto', maxWidth: 120, objectFit: 'contain', flexShrink: 0, display: 'block' }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 17, lineHeight: 1.25 }}>Финансовый модуль</div>
            <div style={{ fontSize: 12, color: '#8a8fa8' }}>
              {companyDisplayName(workspace)} · Контроль дебиторки
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>Компания</label>
            <select
              value={workspace}
              onChange={(e) => {
                const s = e.target.value
                persistCompanySlug(s)
                setWorkspace(s)
              }}
              aria-label="Компания"
              style={{
                width: '100%',
                border: '1px solid #e8e9ef',
                borderRadius: 9,
                padding: '10px 13px',
                fontSize: 14,
                outline: 'none',
                color: '#1a1d23',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
                cursor: 'pointer',
                background: '#fff',
              }}
            >
              {companies.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: '#8a8fa8', marginTop: 6, lineHeight: 1.4 }}>
              У каждой компании своя база: проекты и пользователи не смешиваются.
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>Email (логин)</label>
            <input
              type="text"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="email@example.com"
              autoComplete="username"
              style={{ width: '100%', border: '1px solid #e8e9ef', borderRadius: 9, padding: '10px 13px', fontSize: 14, outline: 'none', color: '#1a1d23', boxSizing: 'border-box' }}
            />
            <div style={{ fontSize: 11, color: '#8a8fa8', marginTop: 6, lineHeight: 1.4 }}>
              Используйте тот же email, что указан при создании пользователя (не имя).
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>Пароль</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ width: '100%', border: '1px solid #e8e9ef', borderRadius: 9, padding: '10px 13px', fontSize: 14, outline: 'none', color: '#1a1d23', boxSizing: 'border-box' }}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 20, cursor: 'pointer', userSelect: 'none' }}>
            <div
              onClick={() => setRemember(v => !v)}
              style={{
                width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                border: `2px solid ${remember ? '#1a6b3c' : '#d0d3de'}`,
                background: remember ? '#1a6b3c' : '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all .15s',
              }}
            >
              {remember && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <span style={{ fontSize: 13, color: '#444' }} onClick={() => setRemember(v => !v)}>Запомнить меня</span>
          </label>

          {error && <div style={{ background: '#fef0f0', color: '#e84040', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}

          <button
            type="submit"
            disabled={loading}
            style={{ width: '100%', background: '#1f7a46', color: '#fff', border: 'none', borderRadius: 9, padding: '11px', fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .7 : 1, fontFamily: 'inherit' }}
          >
            {loading ? 'Входим...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  )
}
